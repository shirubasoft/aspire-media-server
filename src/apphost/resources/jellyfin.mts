import { join } from "node:path";
import { images } from "../images.mjs";

import {
  createHttpResource,
  exposeHttp,
  type HttpResource,
  type ResourceContext,
} from "./resource.mjs";

export type JellyfinResource = HttpResource<"jellyfin">;

export function addJellyfin(
  context: ResourceContext,
): JellyfinResource {
  const resource = exposeHttp(
    context.builder
      .addContainer(
        "jellyfin",
        images.jellyfin,
      )
      .withEnvironment("TZ", context.parameters.timezone)
      .withBindMount(join(context.paths.data, "jellyfin"), "/config")
      .withBindMount(
        join(context.paths.data, "jellyfin-cache"),
        "/cache",
      )
      .withBindMount(context.paths.media, "/media"),
    8096,
    "/health",
  );

  return createHttpResource("jellyfin", resource);
}
