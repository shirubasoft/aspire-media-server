import { join } from "node:path";

import {
  createHttpResource,
  exposeHttp,
  type HttpResource,
  type ResourceContext,
} from "./resource.mjs";

export type PrometheusResource = HttpResource<"prometheus">;

export function addPrometheus(
  context: ResourceContext,
): PrometheusResource {
  const resource = exposeHttp(
    context.builder
      .addContainer(
        "prometheus",
        "docker.io/prom/prometheus:latest",
      )
      .withVolume("/prometheus", { name: "prometheus-data" })
      .withBindMount(
        join(context.paths.data, "prometheus-config"),
        "/etc/prometheus",
        { isReadOnly: true },
      ),
    9090,
    "/-/healthy",
  );

  return createHttpResource("prometheus", resource);
}
