import { resolve } from "node:path";

import { validateArrspirePathLayout } from "../apphost/path-validation.mjs";
import type { ArrspireOperatorConfig } from "../apphost/paths.mjs";
import { ntfyConfiguration } from "../control-plane/src/notifications.js";
import { validateConfiguration } from "../control-plane/src/validation.js";

export interface SetupValues {
  readonly vpnProvider: string;
  readonly vpnCountries: string;
  readonly vpnWireguardKey: string;
  readonly timezone: string;
  readonly jellyfinLanguage: string;
  readonly subtitleLanguages: string;
  readonly traefikDomain: string;
  readonly traefikTlsMode: string;
  readonly traefikAcmeEmail: string;
  readonly cloudflareDnsApiToken: string;
  readonly dataPath: string;
  readonly mediaPath: string;
  readonly downloadsPath: string;
  readonly ntfyEndpoint: string;
  readonly ntfyTopic: string;
  readonly ntfyToken: string;
}

export function operatorConfig(values: SetupValues): ArrspireOperatorConfig {
  const paths = {
    data: resolve(values.dataPath),
    media: resolve(values.mediaPath),
    downloads: resolve(values.downloadsPath),
  };
  validateArrspirePathLayout(paths);
  return {
    schemaVersion: 1,
    paths,
  };
}

export function setupParameters(
  values: SetupValues,
): Readonly<Record<string, string>> {
  return {
    "vpn-provider": values.vpnProvider.trim(),
    "vpn-wireguard-key": values.vpnWireguardKey.trim(),
    "vpn-countries": values.vpnCountries.trim(),
    timezone: values.timezone.trim(),
    "jellyfin-language": values.jellyfinLanguage.trim(),
    "subtitle-languages": values.subtitleLanguages.trim(),
    "traefik-domain": values.traefikDomain.trim(),
    "traefik-tls-mode": values.traefikTlsMode.trim(),
    "traefik-acme-email": values.traefikAcmeEmail.trim(),
    "cloudflare-dns-api-token": values.cloudflareDnsApiToken.trim(),
    "ntfy-endpoint": values.ntfyEndpoint.trim(),
    "ntfy-topic": values.ntfyTopic.trim(),
    "ntfy-token": values.ntfyToken.trim(),
  };
}

export function validateSetupValues(values: SetupValues): void {
  const parameters = setupParameters(values);
  validateConfiguration({
    VPN_PROVIDER: parameters["vpn-provider"],
    VPN_COUNTRIES: parameters["vpn-countries"],
    VPN_WIREGUARD_KEY: parameters["vpn-wireguard-key"],
    TIMEZONE: parameters.timezone,
    JELLYFIN_LANGUAGE: parameters["jellyfin-language"],
    SUBTITLE_LANGUAGES: parameters["subtitle-languages"],
    MINIMUM_SEEDERS: "1",
    USE_ORIGINAL_TITLE: "false",
    TRAEFIK_DOMAIN: parameters["traefik-domain"],
    TRAEFIK_TLS_MODE: parameters["traefik-tls-mode"],
    TRAEFIK_ACME_EMAIL: parameters["traefik-acme-email"],
    CF_DNS_API_TOKEN: parameters["cloudflare-dns-api-token"],
    INGRESS_ADMIN_USER: "admin",
    INGRESS_ADMIN_PASSWORD: "validated-during-setup",
    AUTHELIA_SESSION_SECRET: "s".repeat(64),
    AUTHELIA_STORAGE_ENCRYPTION_KEY: "e".repeat(64),
  });
  ntfyConfiguration({
    NTFY_ENDPOINT: parameters["ntfy-endpoint"],
    NTFY_TOPIC: parameters["ntfy-topic"],
    NTFY_TOKEN: parameters["ntfy-token"],
  });
  operatorConfig(values);
}
