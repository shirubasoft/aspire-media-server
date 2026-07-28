import { join } from "node:path";

import {
  createHttpResource,
  exposeHttp,
  type HttpResource,
  type ResourceContext,
} from "./resource.mjs";
import type { PrometheusResource } from "./prometheus.mjs";

export type GrafanaResource = HttpResource<"grafana">;

export function addGrafana(
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

  return createHttpResource("grafana", resource);
}
