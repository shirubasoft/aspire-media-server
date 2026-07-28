import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
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
const environmentFile = resolve(outputDirectory, ".env");

async function run(
  command: string,
  args: readonly string[],
  quiet = false,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
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

async function buildControlPlane(engine: Engine): Promise<void> {
  await run(engine, [
    "build",
    "--file",
    "control-plane/Dockerfile",
    "--tag",
    "localhost/arrspire-control-plane:1.0.0",
    ".",
  ]);
}

async function publish(engine: Engine): Promise<void> {
  await buildControlPlane(engine);
  await run("aspire", [
    "publish",
    "--output-path",
    outputDirectory,
    "--non-interactive",
  ]);
  // Aspire's Compose publisher materializes resolved secret parameters in this
  // file. Restrict it before handing the artifact to a container engine.
  await chmod(environmentFile, 0o600);
}

if (action === "publish") {
  await publish(await containerEngine());
} else {
  const engine = await containerEngine();
  if (action === "deploy") {
    await publish(engine);
    await run(engine, [
      "compose",
      "--env-file",
      environmentFile,
      "--file",
      composeFile,
      "up",
      "--detach",
      "--remove-orphans",
    ]);
  } else {
    await run(engine, [
      "compose",
      "--env-file",
      environmentFile,
      "--file",
      composeFile,
      "down",
      "--remove-orphans",
    ]);
  }
}
