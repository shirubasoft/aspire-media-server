import { spawn } from "node:child_process";
import { access, chmod, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { selectComposeProjectName } from "../apphost/compose-project.mjs";
import {
  defaultTraefikDomain,
  httpsServiceUrl,
  publishedTraefikHttpsPort,
} from "../apphost/ingress.mjs";
import {
  authenticationDescription,
  credentialSources,
  serviceSurfaces,
} from "../control-plane/src/service-surfaces.js";
import {
  classifyResult,
  compactReason,
  type ReconciliationResult,
  type ResultCategory,
} from "../control-plane/src/readiness.js";

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

async function output(
  command: string,
  args: readonly string[],
): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(chunks).toString("utf8"));
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

async function parameterSecretEnvironment(): Promise<NodeJS.ProcessEnv> {
  let values: unknown;
  try {
    values = JSON.parse(
      await output("aspire", [
        "secret",
        "list",
        "--format",
        "Json",
        "--non-interactive",
        "--nologo",
      ]),
    ) as unknown;
  } catch {
    return {};
  }
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    return {};
  }

  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith("Parameters:") || typeof value !== "string") {
      continue;
    }
    const parameterName = key
      .slice("Parameters:".length)
      .replaceAll("-", "_");
    const environmentName = `Parameters__${parameterName}`;
    if (process.env[environmentName] === undefined) {
      environment[environmentName] = value;
    }
  }
  return environment;
}

async function composeArguments(
  engine: Engine,
  command: readonly string[],
): Promise<readonly string[]> {
  let projectName: string | undefined;
  try {
    projectName = selectComposeProjectName(
      await output(engine, ["compose", "ls", "--format", "json"]),
      composeFile,
    );
  } catch {
    // Before the first deployment, Compose has no matching project yet.
  }
  return [
    "compose",
    ...(projectName === undefined
      ? []
      : ["--project-name", projectName]),
    "--env-file",
    deploymentEnvironmentFile,
    "--file",
    composeFile,
    ...command,
  ];
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
  await run(
    "aspire",
    [
      "publish",
      "--output-path",
      outputDirectory,
      "--environment",
      environment,
      "--non-interactive",
    ],
    false,
    await parameterSecretEnvironment(),
  );
  await chmod(publishEnvironmentFile, 0o600);
}

async function deploy(engine: Engine): Promise<void> {
  const secretEnvironment = await parameterSecretEnvironment();
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
    { ...secretEnvironment, ASPIRE_CONTAINER_RUNTIME: engine },
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
  await run(
    engine,
    await composeArguments(engine, ["down", "--remove-orphans"]),
  );
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

function reconciliationResults(
  value: unknown,
): readonly ReconciliationResult[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (result): result is ReconciliationResult =>
      typeof result === "object" &&
      result !== null &&
      typeof (result as { name?: unknown }).name === "string" &&
      typeof (result as { required?: unknown }).required === "boolean" &&
      ["ready", "skipped", "failed"].includes(
        String((result as { status?: unknown }).status),
      ),
  );
}

function printResultSection(
  title: string,
  category: ResultCategory,
  results: readonly ReconciliationResult[],
): void {
  const matches = results.filter(
    (result) => classifyResult(result) === category,
  );
  if (matches.length === 0) {
    return;
  }
  console.log(title);
  console.table(
    matches.map((result) => ({
      integration: result.name,
      reason: compactReason(result.reason),
    })),
  );
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
    defaultTraefikDomain;
  const dataPath =
    values.BOOTSTRAP_BINDMOUNT_0 ??
    process.env.ARRSPIRE_DATA_PATH ??
    resolve("..", "data");
  console.log("\nArrspire access (HTTPS)");
  console.table(
    serviceSurfaces.map((surface) => {
      return {
        service: surface.label,
        url: httpsServiceUrl(surface.name, domain, httpsPort),
        authentication: authenticationDescription(surface.authentication),
      };
    }),
  );
  console.log("Initial credential sources");
  console.table(credentialSources);

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
  const results = reconciliationResults(reconciliation?.results);
  printResultSection(
    "Needs attention",
    "needs-attention",
    results,
  );
  printResultSection(
    "External services unavailable",
    "externally-unavailable",
    results,
  );
  printResultSection(
    "Optional integrations not configured",
    "not-configured",
    results,
  );

  if (engine !== undefined) {
    try {
      await Promise.all([
        access(composeFile),
        access(deploymentEnvironmentFile),
      ]);
      console.log("Container state");
      await run(engine, await composeArguments(engine, ["ps"]));
    } catch {
      console.log("No prepared deployment is available for container status.");
    }
  }
  console.log(
    "If readiness needs attention or has failed, correct the issue and run npm run repair.",
  );
}

async function repair(engine: Engine): Promise<void> {
  await Promise.all([
    access(composeFile),
    access(deploymentEnvironmentFile),
  ]);
  await run(
    engine,
    await composeArguments(engine, ["run", "--rm", "reconciler"]),
  );
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
