import { join } from "node:path";

import {
  type ArrspireResource,
  createResource,
  type ResourceContext,
} from "./resource.mjs";

export type RecyclarrResource = ArrspireResource<"recyclarr">;

export function addRecyclarr(
  context: ResourceContext,
): RecyclarrResource {
  const resource = context.builder
    .addContainer(
      "recyclarr",
      "ghcr.io/recyclarr/recyclarr:latest",
    )
    .withEnvironment("TZ", context.parameters.timezone)
    .withEnvironment("CRON_SCHEDULE", "@daily")
    .withBindMount(join(context.paths.data, "recyclarr"), "/config");

  return createResource("recyclarr", resource);
}
