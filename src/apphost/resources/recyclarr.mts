import { join } from "node:path";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  ArrspireResource,
  type ResourceContext,
} from "./resource.mjs";

export class RecyclarrResource extends ArrspireResource<"recyclarr"> {
  private constructor(resource: ContainerResourcePromise) {
    super("recyclarr", resource);
  }

  static add(context: ResourceContext): RecyclarrResource {
    return new RecyclarrResource(
      context.builder
        .addContainer(
          "recyclarr",
          "ghcr.io/recyclarr/recyclarr:latest",
        )
        .withEnvironment("TZ", context.parameters.timezone)
        .withEnvironment("CRON_SCHEDULE", "@daily")
        .withBindMount(join(context.paths.data, "recyclarr"), "/config"),
    );
  }
}
