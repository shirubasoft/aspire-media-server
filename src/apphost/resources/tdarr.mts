import { join } from "node:path";
import { images } from "../images.mjs";

import type { EndpointReferencePromise } from "../../.aspire/modules/aspire.mjs";
import {
  type ArrspireResource,
  directHostAccessEnabled,
  type ResourceContext,
} from "./resource.mjs";

export type TdarrResource = ArrspireResource<"tdarr"> &
  Readonly<{
    webUi: EndpointReferencePromise;
    server: EndpointReferencePromise;
  }>;

export function addTdarr(context: ResourceContext): TdarrResource {
  const directAccess = directHostAccessEnabled();
  const resource = context.builder
    .addContainer("tdarr", images.tdarr)
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
    .withEndpoint({
      name: "webui",
      scheme: "http",
      targetPort: 8265,
      isExternal: directAccess,
      ...(directAccess ? { port: 8265 } : {}),
    })
    .withEndpoint({
      name: "server",
      scheme: "http",
      targetPort: 8266,
      isExternal: directAccess,
      ...(directAccess ? { port: 8266 } : {}),
    })
    .withHttpHealthCheck({
      endpointName: "webui",
      path: "/api/v2/status",
    });

  return {
    kind: "tdarr",
    resource,
    webUi: resource.getEndpoint("webui"),
    server: resource.getEndpoint("server"),
  };
}
