import { spawnSync } from "node:child_process";

const instanceId = process.argv[2];
if (
  instanceId === undefined ||
  !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(instanceId)
) {
  throw new Error(
    "Pass the exact ARRSPIRE_INSTANCE_ID to clean up; broad container deletion is intentionally unsupported.",
  );
}

const configured = process.env.ARRSPIRE_CONTAINER_ENGINE;
const runtime =
  configured === "podman" || configured === "docker"
    ? configured
    : "docker";

for (const service of ["qbittorrent", "prowlarr", "gluetun"]) {
  const name = `arrspire-${instanceId}-${service}`;
  const result = spawnSync(runtime, ["rm", "--force", name], {
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
}
