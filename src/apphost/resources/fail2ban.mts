import { join } from "node:path";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  ArrspireResource,
  type ResourceContext,
} from "./resource.mjs";
import { TraefikResource } from "./traefik.mjs";

export class Fail2banResource extends ArrspireResource<"fail2ban"> {
  private constructor(resource: ContainerResourcePromise) {
    super("fail2ban", resource);
  }

  static async add(
    context: ResourceContext,
    traefik: TraefikResource,
  ): Promise<Fail2banResource> {
    const resource = context.builder
      .addContainer("fail2ban", "docker.io/crazymax/fail2ban:latest")
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

    return new Fail2banResource(resource);
  }
}
