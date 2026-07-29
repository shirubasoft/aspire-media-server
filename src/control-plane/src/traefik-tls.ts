export const traefikTlsModes = [
  "local",
  "cloudflare-acme",
] as const;

export type TraefikTlsMode = (typeof traefikTlsModes)[number];

function value(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  return environment[name]?.trim() ?? "";
}

export function resolveTraefikTlsMode(
  environment: NodeJS.ProcessEnv,
): TraefikTlsMode {
  const mode = value(environment, "TRAEFIK_TLS_MODE") || "local";
  if (!traefikTlsModes.includes(mode as TraefikTlsMode)) {
    throw new Error(
      `TRAEFIK_TLS_MODE must be one of ${traefikTlsModes.join(", ")}; received ${mode}`,
    );
  }
  return mode as TraefikTlsMode;
}

export function validateTraefikTlsConfiguration(
  environment: NodeJS.ProcessEnv,
  domain: string,
): TraefikTlsMode {
  const mode = resolveTraefikTlsMode(environment);
  if (mode === "local") {
    return mode;
  }
  if (domain === "localhost") {
    throw new Error(
      "TRAEFIK_DOMAIN must be a publicly registered domain when TRAEFIK_TLS_MODE=cloudflare-acme",
    );
  }

  const email = value(environment, "TRAEFIK_ACME_EMAIL");
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
    email.length > 254
  ) {
    throw new Error(
      "TRAEFIK_ACME_EMAIL must be a valid contact email when TRAEFIK_TLS_MODE=cloudflare-acme",
    );
  }
  if (!value(environment, "CF_DNS_API_TOKEN")) {
    throw new Error(
      "CF_DNS_API_TOKEN is required when TRAEFIK_TLS_MODE=cloudflare-acme",
    );
  }
  return mode;
}

export function traefikRouterTlsConfiguration(
  mode: TraefikTlsMode,
): string {
  return mode === "cloudflare-acme"
    ? `      tls:
        certResolver: letsencrypt`
    : "      tls: {}";
}
