import { join } from "node:path";
import { images } from "../images.mjs";

import {
  type ArrspireResource,
  createResource,
  type ResourceContext,
} from "./resource.mjs";
import type { TraefikResource } from "./traefik.mjs";

export type Fail2banResource = ArrspireResource<"fail2ban">;

export async function addFail2ban(
  context: ResourceContext,
  traefik: TraefikResource,
): Promise<Fail2banResource> {
  const resource = context.builder
    .addContainer("fail2ban", images.fail2ban)
    .withEnvironment("TZ", context.parameters.timezone)
    .withEnvironment("F2B_LOG_TARGET", "STDOUT")
    .withEnvironment("F2B_LOG_LEVEL", "INFO")
    .withEnvironment("F2B_DB_PURGE_AGE", "7d")
    .withBindMount(join(context.paths.data, "fail2ban"), "/data")
    .withBindMount(
      join(context.paths.data, "traefik", "logs"),
      "/var/log/traefik",
      { isReadOnly: true },
    )
    .waitFor(traefik.resource);

  await resource.publishAsDockerComposeService(
    async (_compose, service) => {
      await service.capAdd.add("NET_ADMIN");
      await service.capAdd.add("NET_RAW");
      await service.networkMode.set("host");
      await service.networks.clear();
      await service.restart.set("unless-stopped");
    },
  );

  return createResource("fail2ban", resource);
}
