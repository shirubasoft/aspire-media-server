import { spawn } from "node:child_process";
import { access, chmod, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  httpsServiceUrl,
  publishedTraefikHttpsPort,
} from "../apphost/ingress.mjs";

type Action = "deploy" | "down" | "publish" | "repair" | "status";
type Engine = "docker" | "podman";

const action = (process.argv[2] ?? "deploy") as Action;
if (!["deploy", "down", "publish", "repair", "status"].includes(action)) {
  throw new Error(`Unknown deployment action: ${action}`);
}

const outputDirectory = resolve(
  process.env.ARRSPIRE_OUTPUT_PATH ?? "aspire-output",
);
const composeFile = resolve(outputDirectory, "docker-compose.yaml");
const environment = process.env.ARRSPIRE_ENVIRONMENT ?? "Production";
const publishEnvironmentFile = resolve(outputDirectory, ".env");
const deploymentEnvironmentFile = resolve(
  outputDirectory,
  `.env.${environment}`,
);

// Aspire deployment artifacts can contain resolved secrets. Keep all files
// created by this process private even before their final permissions are set.
process.umask(0o077);

async function run(
  command: string,
  args: readonly string[],
  quiet = false,
  environmentOverrides: Readonly<NodeJS.ProcessEnv> = {},
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...environmentOverrides },
      stdio: quiet ? "ignore" : "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${command} exited with ${String(code)}${signal ? ` (${signal})` : ""}`,
        ),
      );
    });
  });
}

async function available(engine: Engine): Promise<boolean> {
  try {
    await run(engine, ["info"], true);
    await run(engine, ["compose", "version"], true);
    return true;
  } catch {
    return false;
  }
}

async function containerEngine(): Promise<Engine> {
  const configured = process.env.ARRSPIRE_CONTAINER_ENGINE;
  if (configured === "docker" || configured === "podman") {
    return configured;
  }
  if (await available("docker")) {
    return "docker";
  }
  if (await available("podman")) {
    return "podman";
  }
  throw new Error(
    "Neither Docker Compose nor Podman Compose is available. Set ARRSPIRE_CONTAINER_ENGINE after installing one.",
  );
}

async function publish(): Promise<void> {
  await run("aspire", [
    "publish",
    "--output-path",
    outputDirectory,
    "--environment",
    environment,
    "--non-interactive",
  ]);
  await chmod(publishEnvironmentFile, 0o600);
}

async function deploy(engine: Engine): Promise<void> {
  await run(
    "aspire",
    [
      "deploy",
      "--output-path",
      outputDirectory,
      "--environment",
      environment,
      "--non-interactive",
    ],
    false,
    { ASPIRE_CONTAINER_RUNTIME: engine },
  );
  await chmod(deploymentEnvironmentFile, 0o600);
}

async function down(engine: Engine): Promise<void> {
  try {
    await Promise.all([
      access(composeFile),
      access(deploymentEnvironmentFile),
    ]);
  } catch {
    throw new Error(
      `No prepared ${environment} deployment exists in ${outputDirectory}. Run npm run deploy first.`,
    );
  }
  await run(engine, [
    "compose",
    "--env-file",
    deploymentEnvironmentFile,
    "--file",
    composeFile,
    "down",
    "--remove-orphans",
  ]);
}

async function environmentValues(): Promise<
  Readonly<Record<string, string>>
> {
  try {
    const content = await readFile(deploymentEnvironmentFile, "utf8");
    return Object.fromEntries(
      content
        .split(/\r?\n/u)
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          const name = line.slice(0, separator);
          const raw = line.slice(separator + 1);
          const value =
            raw.startsWith('"') && raw.endsWith('"')
              ? raw.slice(1, -1).replaceAll('\\"', '"')
              : raw;
          return [name, value];
        }),
    );
  } catch {
    return {};
  }
}

async function readStatusFile(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

async function printStatus(engine?: Engine): Promise<void> {
  const values = await environmentValues();
  let httpsPort = 443;
  try {
    httpsPort = publishedTraefikHttpsPort(
      await readFile(composeFile, "utf8"),
    );
  } catch {
    // The conventional HTTPS port is still the useful pre-publication default.
  }
  const domain =
    values.TRAEFIK_DOMAIN ??
    process.env.Parameters__traefik_domain ??
    "localhost";
  const dataPath =
    values.BOOTSTRAP_BINDMOUNT_0 ??
    process.env.ARRSPIRE_DATA_PATH ??
    resolve("..", "data");
  const accessRows = [
    ["Jellyfin", false],
    ["Jellyseerr", false],
    ["Sonarr", true],
    ["Radarr", true],
    ["Lidarr", true],
    ["Prowlarr", true],
    ["Bazarr", true],
    ["qBittorrent", true],
    ["Duplicati", true],
    ["Tdarr", true],
    ["Prometheus", true],
    ["Grafana", true],
    ["Traefik dashboard", true],
  ] as const;
  console.log("\nArrspire access (HTTPS)");
  console.table(
    accessRows.map(([label, ingressAuthentication]) => {
      const service = label.toLowerCase().split(" ")[0];
      return {
        service: label,
        url: httpsServiceUrl(service, domain, httpsPort),
        authentication: ingressAuthentication
          ? "Arrspire ingress credentials"
          : "Service credentials",
      };
    }),
  );
  console.log("Initial credential sources");
  console.table([
    {
      surface: "Administrative ingress",
      username: "Parameters:ingress-admin-user",
      password: "Parameters:ingress-admin-password",
    },
    {
      surface: "Jellyfin / Jellyseerr",
      username: "Parameters:jellyfin-admin-user",
      password: "Parameters:jellyfin-admin-password",
    },
    {
      surface: "qBittorrent",
      username: "admin",
      password: "Parameters:qbittorrent-password",
    },
    {
      surface: "Duplicati",
      username: "(none)",
      password: "Parameters:duplicati-web-password",
    },
    {
      surface: "Grafana",
      username: "admin",
      password: "Parameters:grafana-admin-password",
    },
  ]);

  const [bootstrap, reconciliation] = await Promise.all([
    readStatusFile(resolve(dataPath, "status", "bootstrap.json")),
    readStatusFile(resolve(dataPath, "status", "reconciliation.json")),
  ]);
  console.log("Readiness");
  console.table([
    {
      phase: "bootstrap",
      status: bootstrap?.status ?? "pending",
      updatedAt: bootstrap?.updatedAt ?? "-",
    },
    {
      phase: "reconciliation",
      status: reconciliation?.status ?? "pending",
      updatedAt: reconciliation?.updatedAt ?? "-",
    },
  ]);
  if (Array.isArray(reconciliation?.results)) {
    const attention = reconciliation.results.filter(
      (result) =>
        typeof result === "object" &&
        result !== null &&
        (result as { status?: unknown }).status !== "ready",
    );
    if (attention.length > 0) {
      console.log("Integrations requiring attention");
      console.table(attention);
    }
  }

  if (engine !== undefined) {
    try {
      await Promise.all([
        access(composeFile),
        access(deploymentEnvironmentFile),
      ]);
      console.log("Container state");
      await run(engine, [
        "compose",
        "--env-file",
        deploymentEnvironmentFile,
        "--file",
        composeFile,
        "ps",
      ]);
    } catch {
      console.log("No prepared deployment is available for container status.");
    }
  }
  console.log(
    "If readiness is degraded or failed, add/correct credentials and run npm run repair.",
  );
}

async function repair(engine: Engine): Promise<void> {
  await Promise.all([
    access(composeFile),
    access(deploymentEnvironmentFile),
  ]);
  await run(engine, [
    "compose",
    "--env-file",
    deploymentEnvironmentFile,
    "--file",
    composeFile,
    "run",
    "--rm",
    "reconciler",
  ]);
  await printStatus(engine);
}

if (action === "publish") {
  await publish();
} else if (action === "status") {
  let engine: Engine | undefined;
  try {
    engine = await containerEngine();
  } catch {
    // File-based readiness remains useful without a running engine.
  }
  await printStatus(engine);
} else {
  const engine = await containerEngine();
  if (action === "deploy") {
    await deploy(engine);
    await printStatus(engine);
  } else if (action === "repair") {
    await repair(engine);
  } else {
    await down(engine);
  }
}
