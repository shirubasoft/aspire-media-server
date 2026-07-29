import { join } from "node:path";
import { images } from "../images.mjs";

import type { EndpointReferencePromise } from "../../.aspire/modules/aspire.mjs";
import {
  resolveIngressPorts,
  traefikHttpsRedirectTarget,
} from "../ingress.mjs";
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
    .withEnvironment("TRAEFIK_API_DASHBOARD", "true")
    .withEnvironment("TRAEFIK_API_INSECURE", "false")
    .withEnvironment("TRAEFIK_PING", "true")
    .withEnvironment("TRAEFIK_ENTRYPOINTS_WEB_ADDRESS", ":80")
    .withEnvironment("TRAEFIK_ENTRYPOINTS_WEBSECURE_ADDRESS", ":443")
    .withEnvironment(
      "TRAEFIK_ENTRYPOINTS_WEB_HTTP_REDIRECTIONS_ENTRYPOINT_TO",
      traefikHttpsRedirectTarget(ingressPorts.https),
    )
    .withEnvironment(
      "TRAEFIK_ENTRYPOINTS_WEB_HTTP_REDIRECTIONS_ENTRYPOINT_SCHEME",
      "https",
    )
    .withEnvironment(
      "TRAEFIK_PROVIDERS_FILE_DIRECTORY",
      "/etc/traefik/dynamic",
    )
    .withEnvironment("TRAEFIK_PROVIDERS_FILE_WATCH", "true")
    .withEnvironment("TRAEFIK_ACCESSLOG", "true")
    .withEnvironment(
      "TRAEFIK_ACCESSLOG_FILEPATH",
      "/var/log/traefik/access.log",
    )
    .withEnvironment("TRAEFIK_ACCESSLOG_FORMAT", "common")
    .withEnvironment(
      "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_EMAIL",
      context.parameters.traefikAcmeEmail,
    )
    .withEnvironment(
      "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_STORAGE",
      "/acme/acme.json",
    )
    .withEnvironment(
      "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE",
      "true",
    )
    .withEnvironment(
      "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE_PROVIDER",
      "cloudflare",
    )
    .withEnvironment(
      "TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE_RESOLVERS",
      "1.1.1.1:53,8.8.8.8:53",
    )
    .withEnvironment(
      "CF_DNS_API_TOKEN",
      context.parameters.cloudflareDnsApiToken,
    )
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
