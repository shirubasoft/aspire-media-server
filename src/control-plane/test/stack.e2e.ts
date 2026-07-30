import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { verifyBrowserAcceptance } from "./browser-acceptance.js";

const execute = promisify(execFile);
const projectDirectory = process.cwd();
const testDomain = "192.168.0.15.nip.io";
type ContainerEngine = "docker" | "podman";

function containerEngine(): ContainerEngine {
  const configured = process.env.ARRSPIRE_CONTAINER_ENGINE;
  if (configured === "docker" || configured === "podman") {
    return configured;
  }
  return existsSync("/var/run/docker.sock") ? "docker" : "podman";
}

const engine = containerEngine();

interface RunningAppHost {
  readonly directory: string;
  readonly instanceId: string;
  readonly dashboardUrl: string;
  readonly output: string;
}

async function startAppHost(
  appHostDirectory: string,
  environment: NodeJS.ProcessEnv,
): Promise<RunningAppHost> {
  const { stdout, stderr } = await execute(
    "aspire",
    [
      "start",
      "--isolated",
      "--no-build",
      "--format",
      "json",
      "--non-interactive",
    ],
    {
      cwd: appHostDirectory,
      env: environment,
      timeout: 180_000,
    },
  );
  const result = JSON.parse(stdout) as {
    readonly dashboardUrl?: string;
  };
  assert.ok(result.dashboardUrl, "Aspire start did not return a dashboard URL");
  return {
    directory: appHostDirectory,
    instanceId: environment.ARRSPIRE_INSTANCE_ID!,
    dashboardUrl: result.dashboardUrl,
    // stdout contains the ephemeral dashboard login token. Keep it out of
    // failure diagnostics and CI logs.
    output: stderr.slice(-80_000),
  };
}

async function removeTestContainers(instanceId: string): Promise<void> {
  assert.match(instanceId, /^[a-f0-9]{16}$/u);
  for (const service of ["qbittorrent", "prowlarr", "gluetun"]) {
    try {
      await execute(
        engine,
        ["rm", "--force", `arrspire-${instanceId}-${service}`],
        { cwd: projectDirectory, timeout: 30_000 },
      );
    } catch {
      // Aspire or the wrapper may already have removed the exact container.
    }
  }
}

async function stopAppHost(appHost: RunningAppHost): Promise<void> {
  try {
    await execute(
      "aspire",
      [
        "stop",
        "--apphost",
        join(appHost.directory, "apphost.mts"),
        "--non-interactive",
      ],
      { cwd: appHost.directory, timeout: 60_000 },
    );
  } finally {
    await removeTestContainers(appHost.instanceId);
  }
}

async function acceptanceResult(appHostDirectory: string): Promise<{
  readonly state?: string;
  readonly exitCode?: number;
}> {
  const { stdout } = await execute(
    "aspire",
    [
      "describe",
      "acceptance",
      "--format",
      "json",
      "--non-interactive",
    ],
    { cwd: appHostDirectory, timeout: 30_000 },
  );
  const document = JSON.parse(stdout) as {
    readonly resources?: Array<{
      readonly state?: string;
      readonly exitCode?: number;
    }>;
  };
  return document.resources?.[0] ?? {};
}

async function resourceEndpoint(
  appHostDirectory: string,
  resource: string,
  endpointName: string,
): Promise<string> {
  const { stdout } = await execute(
    "aspire",
    [
      "describe",
      resource,
      "--format",
      "json",
      "--non-interactive",
    ],
    { cwd: appHostDirectory, timeout: 30_000 },
  );
  interface Endpoint {
    readonly name?: string;
    readonly url?: string;
  }
  interface DescribedResource {
    readonly endpoints?: readonly Endpoint[];
    readonly urls?: readonly Endpoint[];
  }
  const document = JSON.parse(stdout) as DescribedResource & {
    readonly resources?: readonly DescribedResource[];
  };
  const described = document.resources?.[0] ?? document;
  const endpoint = [...(described.endpoints ?? []), ...(described.urls ?? [])].find(
    (candidate) => candidate.name === endpointName,
  );
  assert.ok(
    endpoint?.url,
    `${resource} has no ${endpointName} endpoint in Aspire state`,
  );
  return endpoint.url;
}

async function resourceLogs(
  appHostDirectory: string,
  resource: string,
): Promise<string> {
  try {
    const { stdout, stderr } = await execute(
      "aspire",
      [
        "logs",
        resource,
        "--tail",
        "160",
        "--format",
        "table",
        "--non-interactive",
      ],
      { cwd: appHostDirectory, timeout: 30_000 },
    );
    return `${stdout}\n${stderr}`.trim();
  } catch (error) {
    return `Unable to collect logs: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

async function runAcceptance(
  appHostDirectory: string,
  environment: NodeJS.ProcessEnv,
  run: "fresh" | "repeat",
): Promise<void> {
  const appHost = await startAppHost(appHostDirectory, environment);
  try {
    await execute(
      "aspire",
      [
        "wait",
        "acceptance",
        "--status",
        "down",
        "--timeout",
        "900",
        "--non-interactive",
      ],
      { cwd: appHostDirectory, timeout: 920_000 },
    );
    const result = await acceptanceResult(appHostDirectory);
    if (result.exitCode !== 0) {
      const diagnosticResources = [
        "acceptance",
        "reconciler",
        "gluetun",
        "qbittorrent-vpn",
        "prowlarr-vpn",
      ];
      const diagnosticLogs = await Promise.all(
        diagnosticResources.map(async (resource) =>
          `### ${resource}\n${await resourceLogs(appHostDirectory, resource)}`,
        ),
      );
      assert.fail(
        `${run} acceptance exited ${String(result.exitCode)} (${String(result.state)}):\n` +
        `${diagnosticLogs.join("\n\n")}\n\n${appHost.output}`,
      );
    }
    const ingressUrl = await resourceEndpoint(
      appHostDirectory,
      "traefik",
      "https",
    );
    try {
      await verifyBrowserAcceptance({
        ingressUrl,
        dashboardUrl: appHost.dashboardUrl,
        domain: environment.Parameters__traefik_domain!,
        ingressUsername: environment.Parameters__ingress_admin_user!,
        ingressPassword: environment.Parameters__ingress_admin_password!,
        jellyfinUsername: "admin",
        jellyfinPassword: environment.Parameters__jellyfin_admin_password!,
        qbittorrentPassword: environment.Parameters__qbittorrent_password!,
        duplicatiPassword: environment.Parameters__duplicati_web_password!,
        grafanaPassword: environment.Parameters__grafana_admin_password!,
      });
    } catch (error) {
      const diagnosticLogs = await Promise.all(
        ["homepage", "traefik"].map(async (resource) =>
          `### ${resource}\n${await resourceLogs(appHostDirectory, resource)}`,
        ),
      );
      throw new Error(
        `Browser acceptance failed: ${error instanceof Error ? error.message : String(error)}\n\n${diagnosticLogs.join("\n\n")}`,
        { cause: error },
      );
    }
  } finally {
    await stopAppHost(appHost);
  }
}

async function createIsolatedAppHost(root: string): Promise<string> {
  const appHostDirectory = join(root, "apphost");
  await cp(projectDirectory, appHostDirectory, {
    recursive: true,
    filter: (source) => {
      const path = relative(projectDirectory, source);
      const topLevel = path.split(sep)[0];
      return !["aspire-output", "data", "dist", "node_modules"].includes(
        topLevel ?? "",
      );
    },
  });
  await cp(
    join(projectDirectory, "node_modules"),
    join(appHostDirectory, "node_modules"),
    { recursive: true },
  );
  return appHostDirectory;
}

function generatedSecret(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

async function removeTestRoot(root: string): Promise<void> {
  assert.match(root, /[/\\]arrspire-e2e-[^/\\]+$/u);
  try {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250,
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EACCES"
    ) {
      throw error;
    }
    // Container images can create directories owned by internal service users.
    // Widen only this validated temporary data tree, then let Node remove it.
    try {
      if (engine === "podman") {
        await execute(
          "podman",
          ["unshare", "chmod", "-R", "a+rwx", join(root, "data")],
          { cwd: projectDirectory, timeout: 30_000 },
        );
      } else {
        await execute(
          "docker",
          [
            "run",
            "--rm",
            "--volume",
            `${join(root, "data")}:/cleanup`,
            "alpine:3.24",
            "chmod",
            "-R",
            "a+rwx",
            "/cleanup",
          ],
          { cwd: projectDirectory, timeout: 60_000 },
        );
      }
    } catch {
      // Files can disappear while the container runtime finishes teardown.
    }
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 250,
    });
  }
}

void test(
  "fresh real stack auto-configures and remains correct after restart",
  { timeout: 2_000_000 },
  async () => {
    const vpnWireguardKey = process.env.Parameters__vpn_wireguard_key?.trim();
    assert.ok(
      vpnWireguardKey,
      "Set Parameters__vpn_wireguard_key before running the isolated E2E test",
    );
    const root = await mkdtemp(join(tmpdir(), "arrspire-e2e-"));
    const appHostDirectory = await createIsolatedAppHost(root);
    const data = join(root, "data");
    const media = join(root, "media");
    const downloads = join(root, "downloads");
    const writableMediaDirectories = [
      downloads,
      join(media, "movies"),
      join(media, "tv"),
      join(media, "music"),
    ];
    await Promise.all([
      mkdir(data),
      ...writableMediaDirectories.map((directory) =>
        mkdir(directory, { recursive: true }),
      ),
    ]);
    // The Docker runner and LinuxServer's `abc` account can have different
    // numeric IDs. These disposable directories must model writable media
    // mounts regardless of the host/container UID mapping.
    await Promise.all([
      chmod(media, 0o777),
      ...writableMediaDirectories.map((directory) =>
        chmod(directory, 0o777),
      ),
    ]);
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ARRSPIRE_E2E: "true",
      ARRSPIRE_DATA_PATH: data,
      ARRSPIRE_MEDIA_PATH: media,
      ARRSPIRE_DOWNLOADS_PATH: downloads,
      ARRSPIRE_INSTANCE_ID: randomBytes(8).toString("hex"),
      ARRSPIRE_INGRESS_HTTP_PORT: "9080",
      ARRSPIRE_INGRESS_HTTPS_PORT: "9443",
      NO_COLOR: "1",
      Parameters__vpn_wireguard_key: vpnWireguardKey,
      // Exercise the checked-in phone-accessible nip.io default. Chromium's
      // resolver rule keeps this isolated on loopback instead of contacting
      // the LAN deployment that the hostname normally resolves to.
      Parameters__traefik_domain: testDomain,
      Parameters__ingress_admin_user: "admin",
      Parameters__jellyfin_admin_password: generatedSecret(),
      Parameters__qbittorrent_password: generatedSecret(),
      Parameters__duplicati_encryption_key: generatedSecret(32),
      Parameters__duplicati_web_password: generatedSecret(),
      Parameters__grafana_admin_password:
        "ArrspireE2EGrafana123456789",
      Parameters__ingress_admin_password: generatedSecret(),
      Parameters__authelia_session_secret: generatedSecret(64),
      Parameters__authelia_storage_encryption_key: generatedSecret(64),
    };

    try {
      await runAcceptance(appHostDirectory, environment, "fresh");
      await runAcceptance(appHostDirectory, environment, "repeat");
    } finally {
      await removeTestRoot(root);
    }
  },
);
