import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const projectDirectory = process.cwd();

interface RunningAppHost {
  readonly directory: string;
  readonly instanceId: string;
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
  return {
    directory: appHostDirectory,
    instanceId: environment.ARRSPIRE_INSTANCE_ID!,
    output: `${stdout}\n${stderr}`.slice(-80_000),
  };
}

async function removeTestContainers(instanceId: string): Promise<void> {
  assert.match(instanceId, /^[a-f0-9]{16}$/u);
  for (const service of ["qbittorrent", "prowlarr", "gluetun"]) {
    try {
      await execute(
        "podman",
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
      const { stdout: logs } = await execute(
        "aspire",
        [
          "logs",
          "acceptance",
          "--tail",
          "120",
          "--format",
          "table",
          "--non-interactive",
        ],
        { cwd: appHostDirectory, timeout: 30_000 },
      );
      assert.fail(
        `${run} acceptance exited ${String(result.exitCode)} (${String(result.state)}):\n${logs}\n${appHost.output}`,
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
    // Rootless Podman can represent an image's internal service user through
    // a subordinate host UID. Widen only this validated temporary tree, then
    // let Node perform the actual cleanup.
    try {
      await execute(
        "podman",
        ["unshare", "chmod", "-R", "a+rwx", join(root, "data")],
        { cwd: projectDirectory, timeout: 30_000 },
      );
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
    await Promise.all([
      mkdir(data),
      mkdir(media),
      mkdir(downloads),
    ]);
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ARRSPIRE_E2E: "true",
      ARRSPIRE_DATA_PATH: data,
      ARRSPIRE_MEDIA_PATH: media,
      ARRSPIRE_DOWNLOADS_PATH: downloads,
      ARRSPIRE_INSTANCE_ID: randomBytes(8).toString("hex"),
      NO_COLOR: "1",
      Parameters__vpn_wireguard_key: vpnWireguardKey,
      Parameters__jellyfin_admin_password: generatedSecret(),
      Parameters__qbittorrent_password: generatedSecret(),
      Parameters__duplicati_encryption_key: generatedSecret(32),
      Parameters__duplicati_web_password: generatedSecret(),
      Parameters__grafana_admin_password: generatedSecret(),
    };

    try {
      await runAcceptance(appHostDirectory, environment, "fresh");
      await runAcceptance(appHostDirectory, environment, "repeat");
    } finally {
      await removeTestRoot(root);
    }
  },
);
