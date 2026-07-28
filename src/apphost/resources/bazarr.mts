import { join } from "node:path";
import { images } from "../images.mjs";

import {
  createHttpResource,
  exposeHttp,
  type HttpResource,
  type ResourceContext,
  withLinuxServerDefaults,
} from "./resource.mjs";

export type BazarrResource = HttpResource<"bazarr">;

export function addBazarr(context: ResourceContext): BazarrResource {
  const resource = exposeHttp(
    withLinuxServerDefaults(
      context.builder
        .addContainer("bazarr", images.bazarr)
        .withBindMount(join(context.paths.data, "bazarr"), "/config")
        .withBindMount(join(context.paths.media, "movies"), "/movies")
        .withBindMount(join(context.paths.media, "tv"), "/tv"),
      context,
    ),
    6767,
    "/",
  );

  return createHttpResource("bazarr", resource);
}
