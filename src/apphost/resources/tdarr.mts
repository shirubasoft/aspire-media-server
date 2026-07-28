import { join } from "node:path";

import type {
  ContainerResourcePromise,
  EndpointReferencePromise,
} from "../../.aspire/modules/aspire.mjs";
import {
  ArrspireResource,
  type ResourceContext,
} from "./resource.mjs";

export class TdarrResource extends ArrspireResource<"tdarr"> {
  private constructor(resource: ContainerResourcePromise) {
    super("tdarr", resource);
  }

  get webUi(): EndpointReferencePromise {
    return this.endpoint("webui");
  }

  get server(): EndpointReferencePromise {
    return this.endpoint("server");
  }

  static add(context: ResourceContext): TdarrResource {
    const resource = context.builder
      .addContainer("tdarr", "ghcr.io/haveagitgat/tdarr:latest")
      .withEnvironment("TZ", context.parameters.timezone)
      .withEnvironment("PUID", process.getuid?.().toString() ?? "1000")
      .withEnvironment("PGID", process.getgid?.().toString() ?? "1000")
      .withEnvironment("UMASK_SET", "002")
      .withEnvironment("serverIP", "0.0.0.0")
      .withEnvironment("serverPort", "8266")
      .withEnvironment("webUIPort", "8265")
      .withEnvironment("internalNode", "true")
      .withEnvironment("inContainer", "true")
      .withEnvironment("ffmpegVersion", "7")
      .withEnvironment("nodeName", "InternalNode")
      .withBindMount(
        join(context.paths.data, "tdarr", "server"),
        "/app/server",
      )
      .withBindMount(
        join(context.paths.data, "tdarr", "configs"),
        "/app/configs",
      )
      .withBindMount(
        join(context.paths.data, "tdarr", "logs"),
        "/app/logs",
      )
      .withBindMount(
        join(context.paths.data, "tdarr", "transcode-cache"),
        "/temp",
      )
      .withBindMount(context.paths.media, "/media")
      .withHttpEndpoint({
        name: "webui",
        port: 8265,
        targetPort: 8265,
      })
      .withHttpEndpoint({
        name: "server",
        port: 8266,
        targetPort: 8266,
      })
      .withHttpHealthCheck({
        endpointName: "webui",
        path: "/api/v2/status",
      })
      .withExternalHttpEndpoints();

    return new TdarrResource(resource);
  }
}
