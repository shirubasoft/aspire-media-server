import { join } from "node:path";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  exposeHttp,
  type ResourceContext,
  withLinuxServerDefaults,
} from "./resource.mjs";

interface ArrAppDefinition {
  readonly name: "sonarr" | "radarr" | "lidarr";
  readonly image: string;
  readonly port: number;
  readonly mediaDirectory: "tv" | "movies" | "music";
}

export function addArrApp(
  context: ResourceContext,
  definition: ArrAppDefinition,
): ContainerResourcePromise {
  return exposeHttp(
    withLinuxServerDefaults(
      context.builder
        .addContainer(definition.name, definition.image)
        .withBindMount(
          join(context.paths.data, definition.name),
          "/config",
        )
        .withBindMount(
          join(context.paths.media, definition.mediaDirectory),
          `/${definition.mediaDirectory}`,
        )
        .withBindMount(context.paths.downloads, "/downloads"),
      context,
    ),
    definition.port,
    "/ping",
  );
}
