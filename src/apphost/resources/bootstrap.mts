import {
  addControlPlaneContainer,
  type ControlPlaneEndpoints,
  withEndpointEnvironment,
} from "./control-plane.mjs";
import {
  type ArrspireResource,
  createResource,
  type ResourceContext,
} from "./resource.mjs";

export type BootstrapResource = ArrspireResource<"bootstrap">;

export function addBootstrap(
  context: ResourceContext,
  endpoints: ControlPlaneEndpoints,
): BootstrapResource {
  const resource = withEndpointEnvironment(
    addControlPlaneContainer(context, "bootstrap", "bootstrap")
      .withEnvironment(
        "QBITTORRENT_PASSWORD",
        context.parameters.qbittorrentPassword,
      )
      .withEnvironment(
        "TRAEFIK_DOMAIN",
        context.parameters.traefikDomain,
      )
      .withEnvironment(
        "TRAEFIK_TLS_MODE",
        context.parameters.traefikTlsMode,
      )
      .withEnvironment(
        "TRAEFIK_ACME_EMAIL",
        context.parameters.traefikAcmeEmail,
      )
      .withEnvironment(
        "CF_DNS_API_TOKEN",
        context.parameters.cloudflareDnsApiToken,
      )
      .withEnvironment(
        "INGRESS_ADMIN_USER",
        context.parameters.ingressAdminUser,
      )
      .withEnvironment(
        "INGRESS_ADMIN_PASSWORD",
        context.parameters.ingressAdminPassword,
      )
      .withEnvironment("VPN_PROVIDER", context.parameters.vpnProvider)
      .withEnvironment(
        "VPN_WIREGUARD_KEY",
        context.parameters.vpnWireguardKey,
      )
      .withEnvironment(
        "VPN_COUNTRIES",
        context.parameters.vpnCountries,
      )
      .withEnvironment("TIMEZONE", context.parameters.timezone)
      .withEnvironment(
        "JELLYFIN_LANGUAGE",
        context.parameters.jellyfinLanguage,
      )
      .withEnvironment(
        "SUBTITLE_LANGUAGES",
        context.parameters.subtitleLanguages,
      )
      .withEnvironment(
        "USE_ORIGINAL_TITLE",
        context.parameters.useOriginalTitle,
      )
      .withEnvironment(
        "MINIMUM_SEEDERS",
        context.parameters.minimumSeeders,
      )
      .withEnvironment(
        "OPENSUBTITLESCOM_USER",
        context.parameters.opensubtitlesComUser,
      )
      .withEnvironment(
        "OPENSUBTITLESCOM_PASSWORD",
        context.parameters.opensubtitlesComPassword,
      )
      .withEnvironment(
        "OPENSUBTITLESORG_USER",
        context.parameters.opensubtitlesOrgUser,
      )
      .withEnvironment(
        "OPENSUBTITLESORG_PASSWORD",
        context.parameters.opensubtitlesOrgPassword,
      )
      .withEnvironment(
        "LEGENDASDIVX_USER",
        context.parameters.legendasDivxUser,
      )
      .withEnvironment(
        "LEGENDASDIVX_PASSWORD",
        context.parameters.legendasDivxPassword,
      )
      .withEnvironment(
        "LEGENDASNET_USER",
        context.parameters.legendasNetUser,
      )
      .withEnvironment(
        "LEGENDASNET_PASSWORD",
        context.parameters.legendasNetPassword,
      )
      .withEnvironment(
        "PUID",
        process.getuid?.().toString() ?? "1000",
      )
      .withEnvironment(
        "PGID",
        process.getgid?.().toString() ?? "1000",
      ),
    endpoints,
  ).withHiddenOnCompletion();

  return createResource("bootstrap", resource);
}
