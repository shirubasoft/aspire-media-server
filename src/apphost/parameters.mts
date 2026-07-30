import type {
  DistributedApplicationBuilder,
  ParameterResourcePromise,
} from "../.aspire/modules/aspire.mjs";
import { defaultTraefikDomain } from "./ingress.mjs";

export interface ArrspireParameters {
  readonly vpnProvider: ParameterResourcePromise;
  readonly vpnWireguardKey: ParameterResourcePromise;
  readonly vpnCountries: ParameterResourcePromise;
  readonly timezone: ParameterResourcePromise;
  readonly jellyfinAdminUser: ParameterResourcePromise;
  readonly jellyfinAdminPassword: ParameterResourcePromise;
  readonly jellyfinServerName: ParameterResourcePromise;
  readonly jellyfinLanguage: ParameterResourcePromise;
  readonly qbittorrentPassword: ParameterResourcePromise;
  readonly duplicatiEncryptionKey: ParameterResourcePromise;
  readonly duplicatiWebPassword: ParameterResourcePromise;
  readonly grafanaAdminPassword: ParameterResourcePromise;
  readonly subtitleLanguages: ParameterResourcePromise;
  readonly useOriginalTitle: ParameterResourcePromise;
  readonly minimumSeeders: ParameterResourcePromise;
  readonly traefikDomain: ParameterResourcePromise;
  readonly traefikTlsMode: ParameterResourcePromise;
  readonly traefikAcmeEmail: ParameterResourcePromise;
  readonly cloudflareDnsApiToken: ParameterResourcePromise;
  readonly ingressAdminUser: ParameterResourcePromise;
  readonly ingressAdminPassword: ParameterResourcePromise;
  readonly autheliaSessionSecret: ParameterResourcePromise;
  readonly autheliaStorageEncryptionKey: ParameterResourcePromise;
  readonly ntfyEndpoint: ParameterResourcePromise;
  readonly ntfyTopic: ParameterResourcePromise;
  readonly ntfyToken: ParameterResourcePromise;
  readonly opensubtitlesComUser: ParameterResourcePromise;
  readonly opensubtitlesComPassword: ParameterResourcePromise;
  readonly opensubtitlesOrgUser: ParameterResourcePromise;
  readonly opensubtitlesOrgPassword: ParameterResourcePromise;
  readonly legendasDivxUser: ParameterResourcePromise;
  readonly legendasDivxPassword: ParameterResourcePromise;
  readonly legendasNetUser: ParameterResourcePromise;
  readonly legendasNetPassword: ParameterResourcePromise;
}

const generatedSecret = {
  minLength: 24,
  lower: true,
  upper: true,
  numeric: true,
  special: false,
  minLower: 4,
  minUpper: 4,
  minNumeric: 4,
};

export function parameterValue(
  name: string,
  fallback: string,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): string {
  const environmentName = `Parameters__${name.replaceAll("-", "_")}`;
  return environment[environmentName] ?? fallback;
}

export function addArrspireParameters(
  builder: DistributedApplicationBuilder,
): ArrspireParameters {
  return {
    vpnProvider: builder.addParameter("vpn-provider", {
      value: parameterValue("vpn-provider", "protonvpn"),
      publishValueAsDefault: true,
    }),
    vpnWireguardKey: builder.addParameter("vpn-wireguard-key", {
      secret: true,
    }),
    vpnCountries: builder.addParameter("vpn-countries", {
      value: parameterValue("vpn-countries", "Netherlands"),
      publishValueAsDefault: true,
    }),
    timezone: builder.addParameter("timezone", {
      value: parameterValue("timezone", "America/Sao_Paulo"),
      publishValueAsDefault: true,
    }),
    jellyfinAdminUser: builder.addParameter("jellyfin-admin-user", {
      value: parameterValue("jellyfin-admin-user", "admin"),
      publishValueAsDefault: true,
    }),
    jellyfinAdminPassword: builder.addParameterWithGeneratedValue(
      "jellyfin-admin-password",
      generatedSecret,
      { secret: true, persist: true },
    ),
    jellyfinServerName: builder.addParameter("jellyfin-server-name", {
      value: parameterValue("jellyfin-server-name", "arrspire"),
      publishValueAsDefault: true,
    }),
    jellyfinLanguage: builder.addParameter("jellyfin-language", {
      value: parameterValue("jellyfin-language", "pt-BR"),
      publishValueAsDefault: true,
    }),
    qbittorrentPassword: builder.addParameterWithGeneratedValue(
      "qbittorrent-password",
      generatedSecret,
      { secret: true, persist: true },
    ),
    duplicatiEncryptionKey: builder.addParameterWithGeneratedValue(
      "duplicati-encryption-key",
      { ...generatedSecret, minLength: 32 },
      { secret: true, persist: true },
    ),
    duplicatiWebPassword: builder.addParameterWithGeneratedValue(
      "duplicati-web-password",
      generatedSecret,
      { secret: true, persist: true },
    ),
    grafanaAdminPassword: builder.addParameterWithGeneratedValue(
      "grafana-admin-password",
      generatedSecret,
      { secret: true, persist: true },
    ),
    subtitleLanguages: builder.addParameter("subtitle-languages", {
      value: parameterValue("subtitle-languages", "pt-BR"),
      publishValueAsDefault: true,
    }),
    useOriginalTitle: builder.addParameter("use-original-title", {
      value: parameterValue("use-original-title", "false"),
      publishValueAsDefault: true,
    }),
    minimumSeeders: builder.addParameter("minimum-seeders", {
      value: parameterValue("minimum-seeders", "1"),
      publishValueAsDefault: true,
    }),
    traefikDomain: builder.addParameter("traefik-domain", {
      value: parameterValue("traefik-domain", defaultTraefikDomain),
      publishValueAsDefault: true,
    }),
    traefikTlsMode: builder.addParameter("traefik-tls-mode", {
      value: parameterValue("traefik-tls-mode", "local"),
      publishValueAsDefault: true,
    }),
    traefikAcmeEmail: builder.addParameter("traefik-acme-email", {
      value: parameterValue("traefik-acme-email", ""),
      publishValueAsDefault: true,
    }),
    cloudflareDnsApiToken: builder.addParameter(
      "cloudflare-dns-api-token",
      {
        value: parameterValue("cloudflare-dns-api-token", ""),
        secret: true,
      },
    ),
    ingressAdminUser: builder.addParameter("ingress-admin-user", {
      value: parameterValue("ingress-admin-user", "admin"),
      publishValueAsDefault: true,
    }),
    ingressAdminPassword: builder.addParameterWithGeneratedValue(
      "ingress-admin-password",
      generatedSecret,
      { secret: true, persist: true },
    ),
    autheliaSessionSecret: builder.addParameterWithGeneratedValue(
      "authelia-session-secret",
      { ...generatedSecret, minLength: 64 },
      { secret: true, persist: true },
    ),
    autheliaStorageEncryptionKey: builder.addParameterWithGeneratedValue(
      "authelia-storage-encryption-key",
      { ...generatedSecret, minLength: 64 },
      { secret: true, persist: true },
    ),
    ntfyEndpoint: builder.addParameter("ntfy-endpoint", {
      value: parameterValue("ntfy-endpoint", "https://ntfy.sh"),
      publishValueAsDefault: true,
    }),
    ntfyTopic: builder.addParameter("ntfy-topic", {
      value: parameterValue("ntfy-topic", ""),
      secret: true,
    }),
    ntfyToken: builder.addParameter("ntfy-token", {
      value: parameterValue("ntfy-token", ""),
      secret: true,
    }),
    opensubtitlesComUser: builder.addParameter("opensubtitlescom-user", {
      value: parameterValue("opensubtitlescom-user", ""),
      publishValueAsDefault: true,
    }),
    opensubtitlesComPassword: builder.addParameter(
      "opensubtitlescom-password",
      {
        value: parameterValue("opensubtitlescom-password", ""),
        secret: true,
      },
    ),
    opensubtitlesOrgUser: builder.addParameter("opensubtitlesorg-user", {
      value: parameterValue("opensubtitlesorg-user", ""),
      publishValueAsDefault: true,
    }),
    opensubtitlesOrgPassword: builder.addParameter(
      "opensubtitlesorg-password",
      {
        value: parameterValue("opensubtitlesorg-password", ""),
        secret: true,
      },
    ),
    legendasDivxUser: builder.addParameter("legendasdivx-user", {
      value: parameterValue("legendasdivx-user", ""),
      publishValueAsDefault: true,
    }),
    legendasDivxPassword: builder.addParameter("legendasdivx-password", {
      value: parameterValue("legendasdivx-password", ""),
      secret: true,
    }),
    legendasNetUser: builder.addParameter("legendasnet-user", {
      value: parameterValue("legendasnet-user", ""),
      publishValueAsDefault: true,
    }),
    legendasNetPassword: builder.addParameter("legendasnet-password", {
      value: parameterValue("legendasnet-password", ""),
      secret: true,
    }),
  };
}
