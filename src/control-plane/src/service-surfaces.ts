export type AuthenticationMode =
  | "service"
  | "ingress"
  | "ingress+service";

export interface ServiceSurface {
  readonly name: string;
  readonly label: string;
  readonly authentication: AuthenticationMode;
}

export interface CredentialSource {
  readonly surface: string;
  readonly username: string;
  readonly password: string;
}

export const serviceSurfaces = [
  {
    name: "home",
    label: "Arrspire home",
    authentication: "ingress",
  },
  { name: "jellyfin", label: "Jellyfin", authentication: "service" },
  { name: "seerr", label: "Seerr", authentication: "service" },
  { name: "sonarr", label: "Sonarr", authentication: "ingress" },
  { name: "radarr", label: "Radarr", authentication: "ingress" },
  { name: "lidarr", label: "Lidarr", authentication: "ingress" },
  { name: "prowlarr", label: "Prowlarr", authentication: "ingress" },
  { name: "bazarr", label: "Bazarr", authentication: "ingress" },
  {
    name: "qbittorrent",
    label: "qBittorrent",
    authentication: "ingress+service",
  },
  { name: "duplicati", label: "Duplicati", authentication: "service" },
  { name: "tdarr", label: "Tdarr", authentication: "ingress" },
  { name: "prometheus", label: "Prometheus", authentication: "ingress" },
  {
    name: "grafana",
    label: "Grafana",
    authentication: "ingress+service",
  },
  {
    name: "aspire",
    label: "Aspire dashboard",
    authentication: "ingress",
  },
  {
    name: "traefik",
    label: "Traefik dashboard",
    authentication: "ingress",
  },
] as const satisfies readonly ServiceSurface[];

export const credentialSources = [
  {
    surface: "Administrative ingress",
    username: "Parameters:ingress-admin-user",
    password: "Parameters:ingress-admin-password",
  },
  {
    surface: "Jellyfin / Seerr",
    username: "Parameters:jellyfin-admin-user",
    password: "Parameters:jellyfin-admin-password",
  },
  {
    surface: "qBittorrent",
    username: "admin",
    password: "Parameters:qbittorrent-password",
  },
  {
    surface: "Duplicati",
    username: "(none)",
    password: "Parameters:duplicati-web-password",
  },
  {
    surface: "Grafana",
    username: "admin",
    password: "Parameters:grafana-admin-password",
  },
] as const satisfies readonly CredentialSource[];

export function authenticationDescription(
  authentication: AuthenticationMode,
): string {
  if (authentication === "ingress+service") {
    return "Ingress + service credentials";
  }
  return authentication === "ingress"
    ? "Arrspire ingress credentials"
    : "Service credentials";
}

export function requiresIngressAuthentication(
  authentication: AuthenticationMode,
): boolean {
  return authentication !== "service";
}

export function serviceSurface(name: string): ServiceSurface {
  const surface = serviceSurfaces.find((candidate) => candidate.name === name);
  if (surface === undefined) {
    throw new Error(`Unknown Arrspire service surface: ${name}`);
  }
  return surface;
}
