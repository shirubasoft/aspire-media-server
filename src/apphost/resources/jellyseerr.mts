import { join } from "node:path";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  exposeHttp,
  HttpResource,
  type ResourceContext,
  withLinuxServerDefaults,
} from "./resource.mjs";

export class JellyseerrResource extends HttpResource<"jellyseerr"> {
  private constructor(resource: ContainerResourcePromise) {
    super("jellyseerr", resource);
  }

  static add(context: ResourceContext): JellyseerrResource {
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

    return new JellyseerrResource(resource);
  }
}
