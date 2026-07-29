import { validateTraefikTlsConfiguration } from "./traefik-tls.js";

export interface LocaleProfile {
  readonly timezone: string;
  readonly jellyfinLanguage: string;
  readonly subtitleLanguages: readonly string[];
}

export const localeProfiles = {
  "pt-BR": {
    timezone: "America/Sao_Paulo",
    jellyfinLanguage: "pt-BR",
    subtitleLanguages: ["pt-BR"],
  },
  neutral: {
    timezone: "UTC",
    jellyfinLanguage: "en-US",
    subtitleLanguages: ["en"],
  },
} as const satisfies Readonly<Record<string, LocaleProfile>>;

const optionalCredentialPairs = [
  ["OpenSubtitles.com", "OPENSUBTITLESCOM_USER", "OPENSUBTITLESCOM_PASSWORD"],
  ["OpenSubtitles.org", "OPENSUBTITLESORG_USER", "OPENSUBTITLESORG_PASSWORD"],
  ["LegendasDivx", "LEGENDASDIVX_USER", "LEGENDASDIVX_PASSWORD"],
  ["Legendas.net", "LEGENDASNET_USER", "LEGENDASNET_PASSWORD"],
] as const;

function value(environment: NodeJS.ProcessEnv, name: string): string {
  return environment[name]?.trim() ?? "";
}

function requireValue(environment: NodeJS.ProcessEnv, name: string): string {
  const current = value(environment, name);
  if (!current) {
    throw new Error(`${name} is required`);
  }
  return current;
}

function validateTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new Error(
      `TIMEZONE must be an IANA timezone such as UTC or America/Sao_Paulo; received ${timezone}`,
    );
  }
}

function validateLocale(name: string, locale: string): void {
  try {
    const normalized = new Intl.Locale(locale).toString();
    if (normalized.toLowerCase() !== locale.toLowerCase()) {
      throw new Error("not canonical");
    }
  } catch {
    throw new Error(
      `${name} must contain a canonical BCP 47 language tag; received ${locale}`,
    );
  }
}

export function validateWireguardKey(key: string): void {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(key, "base64");
  } catch {
    throw new Error("VPN_WIREGUARD_KEY must be a base64 WireGuard private key");
  }
  if (
    decoded.length !== 32 ||
    decoded.toString("base64").replaceAll("=", "") !== key.replaceAll("=", "")
  ) {
    throw new Error(
      "VPN_WIREGUARD_KEY must decode to exactly 32 bytes; create a WireGuard configuration in your VPN provider portal",
    );
  }
}

function validateVpn(
  provider: string,
  countries: string,
  wireguardKey: string,
): void {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(provider)) {
    throw new Error(
      `VPN_PROVIDER must be the lowercase Gluetun provider identifier; received ${provider}`,
    );
  }
  if (provider === "custom") {
    throw new Error(
      "VPN_PROVIDER=custom is incompatible with Arrspire's provider/country profile; configure a supported Gluetun provider instead",
    );
  }
  const requestedCountries = countries.split(",").map((country) => country.trim());
  if (
    requestedCountries.some(
      (country) =>
        !country ||
        !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(country),
    )
  ) {
    throw new Error(
      "VPN_COUNTRIES must be a comma-separated list of full Gluetun country names, for example Netherlands or United States",
    );
  }
  validateWireguardKey(wireguardKey);
}

function validateOptionalCredentials(environment: NodeJS.ProcessEnv): void {
  for (const [provider, userName, passwordName] of optionalCredentialPairs) {
    const hasUser = Boolean(value(environment, userName));
    const hasPassword = Boolean(value(environment, passwordName));
    if (hasUser !== hasPassword) {
      throw new Error(
        `${provider} is optional, but ${userName} and ${passwordName} must either both be set or both be empty`,
      );
    }
  }
}

export function validateConfiguration(environment: NodeJS.ProcessEnv): void {
  validateVpn(
    requireValue(environment, "VPN_PROVIDER"),
    requireValue(environment, "VPN_COUNTRIES"),
    requireValue(environment, "VPN_WIREGUARD_KEY"),
  );
  validateTimezone(requireValue(environment, "TIMEZONE"));
  validateLocale(
    "JELLYFIN_LANGUAGE",
    requireValue(environment, "JELLYFIN_LANGUAGE"),
  );

  const subtitleLanguages = requireValue(
    environment,
    "SUBTITLE_LANGUAGES",
  ).split(",");
  if (subtitleLanguages.some((language) => !language.trim())) {
    throw new Error(
      "SUBTITLE_LANGUAGES must be a comma-separated list without empty entries",
    );
  }
  for (const language of subtitleLanguages) {
    validateLocale("SUBTITLE_LANGUAGES", language.trim());
  }

  const minimumSeeders = requireValue(environment, "MINIMUM_SEEDERS");
  if (!/^\d+$/u.test(minimumSeeders)) {
    throw new Error("MINIMUM_SEEDERS must be a non-negative integer");
  }
  const originalTitle = requireValue(environment, "USE_ORIGINAL_TITLE");
  if (!["true", "false"].includes(originalTitle.toLowerCase())) {
    throw new Error("USE_ORIGINAL_TITLE must be true or false");
  }

  const domain = requireValue(environment, "TRAEFIK_DOMAIN");
  if (
    domain !== "localhost" &&
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(
      domain,
    )
  ) {
    throw new Error(
      `TRAEFIK_DOMAIN must be localhost or a fully qualified lowercase domain; received ${domain}`,
    );
  }
  validateTraefikTlsConfiguration(environment, domain);
  if (
    !/^[A-Za-z0-9._-]{1,64}$/u.test(
      requireValue(environment, "INGRESS_ADMIN_USER"),
    )
  ) {
    throw new Error(
      "INGRESS_ADMIN_USER must be 1-64 letters, numbers, dots, underscores, or hyphens",
    );
  }
  requireValue(environment, "INGRESS_ADMIN_PASSWORD");
  validateOptionalCredentials(environment);
}

export interface OptionalCredentialState {
  readonly name: string;
  readonly configured: boolean;
  readonly reason?: string;
}

export function optionalCredentialStates(
  environment: NodeJS.ProcessEnv,
): readonly OptionalCredentialState[] {
  return optionalCredentialPairs.map(([provider, userName, passwordName]) => {
    const configured =
      Boolean(value(environment, userName)) &&
      Boolean(value(environment, passwordName));
    return configured
      ? { name: provider, configured }
      : {
          name: provider,
          configured,
          reason: `${userName} and ${passwordName} were not supplied`,
        };
  });
}
