import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ArrspirePaths {
  readonly data: string;
  readonly media: string;
  readonly downloads: string;
  readonly containerSocket: string;
  readonly rootlessPodman: boolean;
}

export function resolveArrspirePaths(
  appHostDirectory: string,
): ArrspirePaths {
  const repositoryRoot = resolve(appHostDirectory, "..");
  const podmanSocket = `/run/user/${process.getuid?.().toString() ?? "1000"}/podman/podman.sock`;
  const podmanSocketAvailable =
    process.platform === "linux" &&
    !existsSync("/var/run/docker.sock") &&
    existsSync(podmanSocket);

  return {
    data: process.env.ARRSPIRE_DATA_PATH ?? join(repositoryRoot, "data"),
    media: process.env.ARRSPIRE_MEDIA_PATH ?? join(homedir(), "media"),
    downloads:
      process.env.ARRSPIRE_DOWNLOADS_PATH ?? join(homedir(), "downloads"),
    containerSocket:
      process.env.ARRSPIRE_CONTAINER_SOCKET ??
      (podmanSocketAvailable ? podmanSocket : "/var/run/docker.sock"),
    rootlessPodman: podmanSocketAvailable,
  };
}
