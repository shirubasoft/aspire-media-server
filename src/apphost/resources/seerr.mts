import { join } from "node:path";
import { images } from "../images.mjs";

import {
  createHttpResource,
  exposeHttp,
  type HttpResource,
  type ResourceContext,
} from "./resource.mjs";

export type SeerrResource = HttpResource<"seerr">;

export function addSeerr(
  context: ResourceContext,
): SeerrResource {
  const resource = exposeHttp(
    context.builder
      .addContainer("seerr", images.seerr)
      // Seerr's official image runs rootless and no longer bundles an init
      // process. Keep the legacy host directory so the image can migrate the
      // existing Jellyseerr database in place on its first start.
      .withContainerRuntimeArgs(["--init"])
      .withEnvironment("TZ", context.parameters.timezone)
      .withBindMount(
        join(context.paths.data, "jellyseerr"),
        "/app/config",
      ),
    5055,
    "/api/v1/status",
  );

  return createHttpResource("seerr", resource);
}
