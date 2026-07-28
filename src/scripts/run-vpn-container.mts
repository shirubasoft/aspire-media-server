import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function removeContainer(runtime: string, containerName: string): void {
  spawnSync(runtime, ["rm", "--force", containerName], {
    stdio: "ignore",
  });
}

const [
  runtime,
  containerName,
  gluetunContainerName,
  appHostPid,
  ...runArgs
] = process.argv.slice(2);
if (
  runtime === undefined ||
  containerName === undefined ||
  gluetunContainerName === undefined ||
  appHostPid === undefined
) {
  console.error(
    "Usage: run-vpn-container.mts <runtime> <container-name> <gluetun-name> <apphost-pid> <run-args...>",
  );
  process.exit(2);
}

const watchdogPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "vpn-lifecycle-watchdog.mts",
);
const watchdog = spawn(
  process.execPath,
  [
    watchdogPath,
    runtime,
    containerName,
    gluetunContainerName,
    String(process.pid),
    appHostPid,
  ],
  {
    detached: true,
    stdio: "ignore",
  },
);
watchdog.unref();

const child = spawn(runtime, runArgs, { stdio: "inherit" });
let stopping = false;

function stop(): void {
  if (!stopping) {
    stopping = true;
    removeContainer(runtime, containerName);
  }
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, stop);
}

child.once("error", (error) => {
  console.error(`Unable to launch ${runtime}:`, error);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (!stopping) {
    process.exitCode = code ?? (signal === null ? 1 : 128);
  }
});
