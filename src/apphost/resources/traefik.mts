import { join } from "node:path";
import { images } from "../images.mjs";

import type { EndpointReferencePromise } from "../../.aspire/modules/aspire.mjs";
import { resolveIngressPorts } from "../ingress.mjs";
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
  const ingressPorts = resolveIngressPorts(context.paths.rootlessPodman);
  const resource = context.builder
    .addContainer("traefik", images.traefik)
    .withArgs([
      "--api.dashboard=true",
      "--api.insecure=false",
      "--ping=true",
      "--entrypoints.web.address=:80",
      "--entrypoints.websecure.address=:443",
      "--entrypoints.web.http.redirections.entrypoint.to=websecure",
      "--entrypoints.web.http.redirections.entrypoint.scheme=https",
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
    .withEndpoint({
      name: "http",
      scheme: "http",
      port: ingressPorts.http,
      targetPort: 80,
      isExternal: true,
    })
    .withEndpoint({
      name: "https",
      scheme: "https",
      port: ingressPorts.https,
      targetPort: 443,
      isExternal: true,
    })
    .withEndpoint({
      name: "dashboard",
      scheme: "http",
      targetPort: 8080,
      isExternal: false,
    })
    .withHttpHealthCheck({
      endpointName: "dashboard",
      path: "/ping",
    });

  return {
    kind: "traefik",
    resource,
    http: resource.getEndpoint("http"),
    https: resource.getEndpoint("https"),
    dashboard: resource.getEndpoint("dashboard"),
  };
}
