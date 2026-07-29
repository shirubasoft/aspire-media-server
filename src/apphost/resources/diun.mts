import { join } from "node:path";
import { refExpr } from "../../.aspire/modules/aspire.mjs";
import { images } from "../images.mjs";
import type { NotifierResource } from "./notifier.mjs";

import {
  type ArrspireResource,
  createResource,
  type ResourceContext,
} from "./resource.mjs";

export type DiunResource = ArrspireResource<"diun">;

export async function addDiun(
  context: ResourceContext,
  notifier: NotifierResource,
): Promise<DiunResource> {
  const notifierEndpoint = await notifier.http;
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
    .withEnvironment(
      "DIUN_NOTIF_WEBHOOK_ENDPOINT",
      refExpr`${notifierEndpoint}/diun`,
    )
    .withEnvironment("DIUN_NOTIF_WEBHOOK_METHOD", "POST")
    .withBindMount(join(context.paths.data, "diun"), "/data")
    .withBindMount(
      context.paths.containerSocket,
      "/var/run/docker.sock",
      { isReadOnly: true },
    )
    .waitFor(notifier.resource);

  return createResource("diun", resource);
}
