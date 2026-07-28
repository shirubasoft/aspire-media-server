import { spawn } from "node:child_process";
import { access, chmod } from "node:fs/promises";
import { resolve } from "node:path";

type Action = "deploy" | "down" | "publish";
type Engine = "docker" | "podman";

const action = (process.argv[2] ?? "deploy") as Action;
if (!["deploy", "down", "publish"].includes(action)) {
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

if (action === "publish") {
  await publish();
} else {
  const engine = await containerEngine();
  if (action === "deploy") {
    await deploy(engine);
  } else {
    await down(engine);
  }
}
