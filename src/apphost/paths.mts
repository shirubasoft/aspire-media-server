import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface ArrspirePaths {
  readonly data: string;
  readonly media: string;
  readonly downloads: string;
  readonly containerSocket: string;
  readonly rootlessPodman: boolean;
}

export interface ArrspireOperatorConfig {
  readonly schemaVersion: 1;
  readonly paths: Readonly<{
    data: string;
    media: string;
    downloads: string;
  }>;
}

export function arrspireOperatorConfigPath(appHostDirectory: string): string {
  return join(appHostDirectory, ".arrspire", "config.json");
}

export function readArrspireOperatorConfig(
  appHostDirectory: string,
): ArrspireOperatorConfig | undefined {
  const path = arrspireOperatorConfigPath(appHostDirectory);
  if (!existsSync(path)) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(
      `Unable to read Arrspire operator config ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const config = value as Partial<ArrspireOperatorConfig>;
  if (
    typeof value !== "object" ||
    value === null ||
    config.schemaVersion !== 1 ||
    typeof config.paths?.data !== "string" ||
    typeof config.paths.media !== "string" ||
    typeof config.paths.downloads !== "string"
  ) {
    throw new Error(
      `Arrspire operator config ${path} does not match schema version 1`,
    );
  }
  return config as ArrspireOperatorConfig;
}

export function resolveArrspirePaths(appHostDirectory: string): ArrspirePaths {
  const repositoryRoot = resolve(appHostDirectory, "..");
  const operatorConfig = readArrspireOperatorConfig(appHostDirectory);
  const podmanSocket = `/run/user/${process.getuid?.().toString() ?? "1000"}/podman/podman.sock`;
  const podmanSocketAvailable =
    process.platform === "linux" &&
    !existsSync("/var/run/docker.sock") &&
    existsSync(podmanSocket);

  return {
    data:
      process.env.ARRSPIRE_DATA_PATH ??
      operatorConfig?.paths.data ??
      join(repositoryRoot, "data"),
    media:
      process.env.ARRSPIRE_MEDIA_PATH ??
      operatorConfig?.paths.media ??
      join(homedir(), "media"),
    downloads:
      process.env.ARRSPIRE_DOWNLOADS_PATH ??
      operatorConfig?.paths.downloads ??
      join(homedir(), "downloads"),
    containerSocket:
      process.env.ARRSPIRE_CONTAINER_SOCKET ??
      (podmanSocketAvailable ? podmanSocket : "/var/run/docker.sock"),
    rootlessPodman: podmanSocketAvailable,
  };
}
