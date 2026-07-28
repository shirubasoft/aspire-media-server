import { spawn, spawnSync } from "node:child_process";

function removeContainer(runtime: string, containerName: string): void {
  spawnSync(runtime, ["rm", "--force", containerName], {
    stdio: "ignore",
  });
}

const [runtime, containerName, ...runArgs] = process.argv.slice(2);
if (runtime === undefined || containerName === undefined) {
  console.error(
    "Usage: run-vpn-container.mts <runtime> <container-name> <run-args...>",
  );
  process.exit(2);
}

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
