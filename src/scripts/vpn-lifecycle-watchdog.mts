import { spawnSync } from "node:child_process";

const [
  runtime,
  containerName,
  gluetunContainerName,
  wrapperPidValue,
  appHostPidValue,
] = process.argv.slice(2);

if (
  runtime === undefined ||
  containerName === undefined ||
  gluetunContainerName === undefined ||
  wrapperPidValue === undefined ||
  appHostPidValue === undefined
) {
  process.exit(2);
}

const wrapperPid = Number.parseInt(wrapperPidValue, 10);
const appHostPid = Number.parseInt(appHostPidValue, 10);
if (!Number.isSafeInteger(wrapperPid) || !Number.isSafeInteger(appHostPid)) {
  process.exit(2);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function removeExact(name: string): void {
  spawnSync(runtime, ["rm", "--force", name], { stdio: "ignore" });
}

let wrapperCleaned = false;
const monitor = setInterval(() => {
  const appHostAlive = processExists(appHostPid);
  const wrapperAlive = processExists(wrapperPid);
  if (!wrapperAlive && !wrapperCleaned) {
    wrapperCleaned = true;
    removeExact(containerName);
  }
  if (!appHostAlive) {
    removeExact(containerName);
    removeExact(gluetunContainerName);
    clearInterval(monitor);
  }
}, 250);

monitor.unref();
await new Promise<void>((resolve) => {
  const keepAlive = setInterval(() => {
    if (!processExists(appHostPid)) {
      clearInterval(keepAlive);
      resolve();
    }
  }, 250);
});
