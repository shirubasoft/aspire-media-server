import { join } from "node:path";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  exposeHttp,
  HttpResource,
  type ResourceContext,
} from "./resource.mjs";

export class JellyfinResource extends HttpResource<"jellyfin"> {
  private constructor(resource: ContainerResourcePromise) {
    super("jellyfin", resource);
  }

  static add(context: ResourceContext): JellyfinResource {
    const resource = exposeHttp(
      context.builder
        .addContainer(
          "jellyfin",
          "docker.io/jellyfin/jellyfin:10.11.11",
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

    return new JellyfinResource(resource);
  }
}
