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
  readonly ingressAdminUser: ParameterResourcePromise;
  readonly ingressAdminPassword: ParameterResourcePromise;
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

export function addArrspireParameters(
  builder: DistributedApplicationBuilder,
): ArrspireParameters {
  return {
    vpnProvider: builder.addParameter("vpn-provider", {
      value: "protonvpn",
      publishValueAsDefault: true,
    }),
    vpnWireguardKey: builder.addParameter("vpn-wireguard-key", {
      secret: true,
    }),
    vpnCountries: builder.addParameter("vpn-countries", {
      value: "Netherlands",
      publishValueAsDefault: true,
    }),
    timezone: builder.addParameter("timezone", {
      value: "America/Sao_Paulo",
      publishValueAsDefault: true,
    }),
    jellyfinAdminUser: builder.addParameter("jellyfin-admin-user", {
      value: "admin",
      publishValueAsDefault: true,
    }),
    jellyfinAdminPassword: builder.addParameterWithGeneratedValue(
      "jellyfin-admin-password",
      generatedSecret,
      { secret: true, persist: true },
    ),
    jellyfinServerName: builder.addParameter("jellyfin-server-name", {
      value: "arrspire",
      publishValueAsDefault: true,
    }),
    jellyfinLanguage: builder.addParameter("jellyfin-language", {
      value: "pt-BR",
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
      value: "pt-BR",
      publishValueAsDefault: true,
    }),
    useOriginalTitle: builder.addParameter("use-original-title", {
      value: "false",
      publishValueAsDefault: true,
    }),
    minimumSeeders: builder.addParameter("minimum-seeders", {
      value: "1",
      publishValueAsDefault: true,
    }),
    traefikDomain: builder.addParameter("traefik-domain", {
      value: defaultTraefikDomain,
      publishValueAsDefault: true,
    }),
    ingressAdminUser: builder.addParameter("ingress-admin-user", {
      value: "admin",
      publishValueAsDefault: true,
    }),
    ingressAdminPassword: builder.addParameterWithGeneratedValue(
      "ingress-admin-password",
      generatedSecret,
      { secret: true, persist: true },
    ),
    opensubtitlesComUser: builder.addParameter("opensubtitlescom-user", {
      value: "",
      publishValueAsDefault: true,
    }),
    opensubtitlesComPassword: builder.addParameter(
      "opensubtitlescom-password",
      { value: "", secret: true },
    ),
    opensubtitlesOrgUser: builder.addParameter("opensubtitlesorg-user", {
      value: "",
      publishValueAsDefault: true,
    }),
    opensubtitlesOrgPassword: builder.addParameter(
      "opensubtitlesorg-password",
      { value: "", secret: true },
    ),
    legendasDivxUser: builder.addParameter("legendasdivx-user", {
      value: "",
      publishValueAsDefault: true,
    }),
    legendasDivxPassword: builder.addParameter("legendasdivx-password", {
      value: "",
      secret: true,
    }),
    legendasNetUser: builder.addParameter("legendasnet-user", {
      value: "",
      publishValueAsDefault: true,
    }),
    legendasNetPassword: builder.addParameter("legendasnet-password", {
      value: "",
      secret: true,
    }),
  };
}
