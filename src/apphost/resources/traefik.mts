import { join } from "node:path";

import type { EndpointReferencePromise } from "../../.aspire/modules/aspire.mjs";
import {
  type ArrspireResource,
  type ResourceContext,
} from "./resource.mjs";

export type TraefikResource = ArrspireResource<"traefik"> &
  Readonly<{
    http: EndpointReferencePromise;
    https: EndpointReferencePromise;
    dashboard: EndpointReferencePromise;
  }>;

export function addTraefik(
  context: ResourceContext,
): TraefikResource {
  const resource = context.builder
    .addContainer("traefik", "docker.io/library/traefik:v3.5")
    .withArgs([
      "--api.dashboard=true",
      "--api.insecure=true",
      "--ping=true",
      "--entrypoints.web.address=:80",
      "--entrypoints.websecure.address=:443",
      "--providers.file.directory=/etc/traefik/dynamic",
      "--providers.file.watch=true",
      "--accesslog=true",
      "--accesslog.filepath=/var/log/traefik/access.log",
      "--accesslog.format=common",
    ])
    .withBindMount(
      join(context.paths.data, "traefik", "dynamic"),
      "/etc/traefik/dynamic",
      { isReadOnly: true },
    )
    .withBindMount(
      join(context.paths.data, "traefik", "acme"),
      "/acme",
    )
    .withBindMount(
      join(context.paths.data, "traefik", "logs"),
      "/var/log/traefik",
    )
    .withHttpEndpoint({ name: "http", port: 80, targetPort: 80 })
    .withHttpEndpoint({ name: "https", port: 443, targetPort: 443 })
    .withHttpEndpoint({
      name: "dashboard",
      port: 8081,
      targetPort: 8080,
    })
    .withHttpHealthCheck({
      endpointName: "dashboard",
      path: "/ping",
    })
    .withExternalHttpEndpoints();

  return {
    kind: "traefik",
    resource,
    http: resource.getEndpoint("http"),
    https: resource.getEndpoint("https"),
    dashboard: resource.getEndpoint("dashboard"),
  };
}
