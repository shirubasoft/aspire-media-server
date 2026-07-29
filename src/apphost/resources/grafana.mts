import { join } from "node:path";
import { images } from "../images.mjs";

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
      .addContainer("grafana", images.grafana)
      .withEnvironment(
        "GF_SECURITY_ADMIN_PASSWORD",
        context.parameters.grafanaAdminPassword,
      )
      .withEnvironment("GF_USERS_ALLOW_SIGN_UP", "false")
      .withBindMount(
        join(context.paths.data, "grafana"),
        "/var/lib/grafana",
      )
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
