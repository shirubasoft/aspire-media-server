import { join } from "node:path";
import { images } from "../images.mjs";

import {
  createHttpResource,
  exposeHttp,
  type HttpResource,
  type ResourceContext,
} from "./resource.mjs";

const backupSources = [
  "sonarr",
  "radarr",
  "lidarr",
  "prowlarr",
  "bazarr",
  "jellyfin",
  "jellyseerr",
  "qbittorrent",
  "gluetun",
] as const;

export type DuplicatiResource = HttpResource<"duplicati">;

export function addDuplicati(
  context: ResourceContext,
): DuplicatiResource {
  let resource = context.builder
    .addContainer("duplicati", images.duplicati)
    .withEnvironment("TZ", context.parameters.timezone)
    .withEnvironment(
      "DUPLICATI__SETTINGS_ENCRYPTION_KEY",
      context.parameters.duplicatiEncryptionKey,
    )
    .withEnvironment(
      "DUPLICATI__WEBSERVICE_PASSWORD",
      context.parameters.duplicatiWebPassword,
    )
    .withBindMount(join(context.paths.data, "duplicati"), "/data")
    .withBindMount(join(context.paths.data, "backups"), "/backups");

  for (const source of backupSources) {
    resource = resource.withBindMount(
      join(context.paths.data, source),
      `/source/${source}`,
      { isReadOnly: true },
    );
  }

  return createHttpResource(
    "duplicati",
    exposeHttp(resource, 8200, "/"),
  );
}
