import { join } from "node:path";
import { images } from "../images.mjs";

import {
  type ArrspireResource,
  createResource,
  type ResourceContext,
} from "./resource.mjs";

export type DiunResource = ArrspireResource<"diun">;

export function addDiun(context: ResourceContext): DiunResource {
  const resource = context.builder
    .addContainer("diun", images.diun)
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
    );

  return createResource("diun", resource);
}
