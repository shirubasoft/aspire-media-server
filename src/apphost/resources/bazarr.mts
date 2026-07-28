import { join } from "node:path";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  exposeHttp,
  HttpResource,
  type ResourceContext,
  withLinuxServerDefaults,
} from "./resource.mjs";

export class BazarrResource extends HttpResource<"bazarr"> {
  private constructor(resource: ContainerResourcePromise) {
    super("bazarr", resource);
  }

  static add(context: ResourceContext): BazarrResource {
    const resource = exposeHttp(
      withLinuxServerDefaults(
        context.builder
          .addContainer("bazarr", "ghcr.io/linuxserver/bazarr:latest")
          .withBindMount(join(context.paths.data, "bazarr"), "/config")
          .withBindMount(join(context.paths.media, "movies"), "/movies")
          .withBindMount(join(context.paths.media, "tv"), "/tv"),
        context,
      ),
      6767,
      "/",
    );

    return new BazarrResource(resource);
  }
}
