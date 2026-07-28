import { join } from "node:path";

import {
  createHttpResource,
  exposeHttp,
  type HttpResource,
  type ResourceContext,
  withLinuxServerDefaults,
} from "./resource.mjs";

export type JellyseerrResource = HttpResource<"jellyseerr">;

export function addJellyseerr(
  context: ResourceContext,
): JellyseerrResource {
  const resource = exposeHttp(
    withLinuxServerDefaults(
      context.builder
        .addContainer(
          "jellyseerr",
          "ghcr.io/fallenbagel/jellyseerr:latest",
        )
        .withBindMount(
          join(context.paths.data, "jellyseerr"),
          "/app/config",
        ),
      context,
    ),
    5055,
    "/api/v1/status",
  );

  return createHttpResource("jellyseerr", resource);
}
