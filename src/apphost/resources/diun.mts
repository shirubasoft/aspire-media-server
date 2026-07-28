import { join } from "node:path";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  ArrspireResource,
  type ResourceContext,
} from "./resource.mjs";

export class DiunResource extends ArrspireResource<"diun"> {
  private constructor(resource: ContainerResourcePromise) {
    super("diun", resource);
  }

  static add(context: ResourceContext): DiunResource {
    return new DiunResource(
      context.builder
        .addContainer("diun", "docker.io/crazymax/diun:latest")
        .withEnvironment("TZ", context.parameters.timezone)
        .withEnvironment("LOG_LEVEL", "info")
        .withEnvironment("LOG_JSON", "false")
        .withEnvironment("DIUN_WATCH_WORKERS", "20")
        .withEnvironment("DIUN_WATCH_SCHEDULE", "0 */6 * * *")
        .withEnvironment("DIUN_PROVIDERS_DOCKER", "true")
        .withEnvironment(
          "DIUN_PROVIDERS_DOCKER_WATCHBYDEFAULT",
          "true",
        )
        .withBindMount(join(context.paths.data, "diun"), "/data")
        .withBindMount(
          context.paths.containerSocket,
          "/var/run/docker.sock",
          { isReadOnly: true },
        ),
    );
  }
}
