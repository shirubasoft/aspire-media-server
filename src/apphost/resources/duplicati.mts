import { join } from "node:path";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  exposeHttp,
  HttpResource,
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

export class DuplicatiResource extends HttpResource<"duplicati"> {
  private constructor(resource: ContainerResourcePromise) {
    super("duplicati", resource);
  }

  static add(context: ResourceContext): DuplicatiResource {
    let resource = context.builder
      .addContainer("duplicati", "docker.io/duplicati/duplicati:latest")
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

    return new DuplicatiResource(exposeHttp(resource, 8200, "/"));
  }
}
