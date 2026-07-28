import { join } from "node:path";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  exposeHttp,
  HttpResource,
  type ResourceContext,
} from "./resource.mjs";
import { PrometheusResource } from "./prometheus.mjs";

export class GrafanaResource extends HttpResource<"grafana"> {
  private constructor(resource: ContainerResourcePromise) {
    super("grafana", resource);
  }

  static add(
    context: ResourceContext,
    prometheus: PrometheusResource,
  ): GrafanaResource {
    const resource = exposeHttp(
      context.builder
        .addContainer("grafana", "docker.io/grafana/grafana:latest")
        .withEnvironment(
          "GF_SECURITY_ADMIN_PASSWORD",
          context.parameters.grafanaAdminPassword,
        )
        .withEnvironment("GF_USERS_ALLOW_SIGN_UP", "false")
        .withVolume("/var/lib/grafana", { name: "grafana-data" })
        .withBindMount(
          join(context.paths.data, "grafana-provisioning"),
          "/etc/grafana/provisioning",
          { isReadOnly: true },
        )
        .waitFor(prometheus.resource),
      3000,
      "/api/health",
    );

    return new GrafanaResource(resource);
  }
}
