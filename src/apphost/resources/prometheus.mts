import { join } from "node:path";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  exposeHttp,
  HttpResource,
  type ResourceContext,
} from "./resource.mjs";

export class PrometheusResource extends HttpResource<"prometheus"> {
  private constructor(resource: ContainerResourcePromise) {
    super("prometheus", resource);
  }

  static add(context: ResourceContext): PrometheusResource {
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

    return new PrometheusResource(resource);
  }
}
