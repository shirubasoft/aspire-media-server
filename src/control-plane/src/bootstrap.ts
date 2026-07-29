import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { chown, mkdir } from "node:fs/promises";

import { optional, required } from "./environment.js";
import { writeIfChanged, writeOnce } from "./files.js";
import { installJellyfinPlugins } from "./jellyfin-plugins.js";
import { log } from "./log.js";
import { writeBootstrapStatus } from "./status.js";
import { validateConfiguration } from "./validation.js";

const dataDirectories = [
  "backups",
  "bazarr",
  "diun",
  "duplicati",
  "fail2ban/filter.d",
  "fail2ban/jail.d",
  "gluetun",
  "grafana",
  "grafana-provisioning/datasources",
  "jellyfin",
  "jellyfin-cache",
  "jellyseerr",
  "lidarr",
  "prometheus",
  "prometheus-config",
  "prowlarr",
  "qbittorrent/qBittorrent",
  "radarr",
  "recyclarr",
  "sonarr",
  "tdarr/configs",
  "tdarr/logs",
  "tdarr/server",
  "tdarr/transcode-cache",
  "traefik/acme",
  "traefik/dynamic",
  "traefik/logs",
] as const;

interface RuntimeDirectory {
  readonly path: string;
  readonly uid: number;
  readonly gid: number;
}

export function runtimeDirectoryPlan(): readonly RuntimeDirectory[] {
  return [
    // Recyclarr runs as UID/GID 1000 and needs to create its migration state
    // under /config when the scheduled job starts.
    { path: "/data/recyclarr", uid: 1000, gid: 1000 },
    { path: "/media/movies", uid: 1000, gid: 1000 },
    { path: "/media/tv", uid: 1000, gid: 1000 },
    { path: "/media/music", uid: 1000, gid: 1000 },
    { path: "/downloads", uid: 1000, gid: 1000 },
    { path: "/downloads/incomplete", uid: 1000, gid: 1000 },
    { path: "/downloads/sonarr", uid: 1000, gid: 1000 },
    { path: "/downloads/radarr", uid: 1000, gid: 1000 },
    { path: "/downloads/lidarr", uid: 1000, gid: 1000 },
  ];
}

interface ArrBootstrap {
  readonly name: "sonarr" | "radarr" | "lidarr" | "prowlarr";
  readonly port: number;
}

const arrServices: readonly ArrBootstrap[] = [
  { name: "sonarr", port: 8989 },
  { name: "radarr", port: 7878 },
  { name: "lidarr", port: 8686 },
  { name: "prowlarr", port: 9696 },
];

function qBittorrentPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, 100_000, 64, "sha512");
  return `@ByteArray(${salt.toString("base64")}:${hash.toString("base64")})`;
}

function qBittorrentConfig(password: string): string {
  return `[Application]
FileLogger\\Age=1
FileLogger\\AgeType=1
FileLogger\\Backup=true
FileLogger\\DeleteOld=true
FileLogger\\Enabled=true
FileLogger\\MaxSizeBytes=66560
FileLogger\\Path=/config/qBittorrent/logs

[BitTorrent]
Session\\DefaultSavePath=/downloads
Session\\Port=6881
Session\\TempPath=/downloads/incomplete

[LegalNotice]
Accepted=true

[Preferences]
WebUI\\Address=*
WebUI\\HostHeaderValidation=false
WebUI\\Password_PBKDF2="${qBittorrentPassword(password)}"
WebUI\\Port=8080
WebUI\\Username=admin
`;
}

function arrConfig({ name, port }: ArrBootstrap): string {
  const apiKey = randomBytes(16).toString("hex");
  return `<Config>
  <LogLevel>info</LogLevel>
  <BindAddress>*</BindAddress>
  <Port>${port}</Port>
  <SslPort>${port + 1}</SslPort>
  <EnableSsl>False</EnableSsl>
  <LaunchBrowser>False</LaunchBrowser>
  <ApiKey>${apiKey}</ApiKey>
  <AuthenticationMethod>External</AuthenticationMethod>
  <AuthenticationRequired>DisabledForLocalAddresses</AuthenticationRequired>
  <Branch>master</Branch>
  <InstanceName>${name[0]?.toUpperCase()}${name.slice(1)}</InstanceName>
</Config>
`;
}

interface RoutedService {
  readonly url: string;
  readonly requiresIngressAuthentication: boolean;
}

function routedServices(): Readonly<Record<string, RoutedService>> {
  return {
    aspire: {
      url: optional(
        "ASPIRE_DASHBOARD_URL",
        "http://arrspire-dashboard:18888",
      ),
      requiresIngressAuthentication: true,
    },
    bazarr: {
      url: required("BAZARR_URL"),
      requiresIngressAuthentication: true,
    },
    duplicati: {
      url: required("DUPLICATI_URL"),
      // Duplicati authenticates API calls with a Bearer token. Applying
      // Traefik BasicAuth here would consume the same Authorization header
      // and make the web UI fail immediately after a successful login.
      requiresIngressAuthentication: false,
    },
    grafana: {
      url: required("GRAFANA_URL"),
      requiresIngressAuthentication: true,
    },
    jellyfin: {
      url: required("JELLYFIN_URL"),
      requiresIngressAuthentication: false,
    },
    jellyseerr: {
      url: required("JELLYSEERR_URL"),
      requiresIngressAuthentication: false,
    },
    lidarr: {
      url: required("LIDARR_URL"),
      requiresIngressAuthentication: true,
    },
    prometheus: {
      url: required("PROMETHEUS_URL"),
      requiresIngressAuthentication: true,
    },
    prowlarr: {
      url: required("PROWLARR_URL"),
      requiresIngressAuthentication: true,
    },
    qbittorrent: {
      url: required("QBITTORRENT_URL"),
      requiresIngressAuthentication: true,
    },
    radarr: {
      url: required("RADARR_URL"),
      requiresIngressAuthentication: true,
    },
    sonarr: {
      url: required("SONARR_URL"),
      requiresIngressAuthentication: true,
    },
    tdarr: {
      url: required("TDARR_URL"),
      requiresIngressAuthentication: true,
    },
  };
}

export function traefikDynamicConfiguration(
  domain: string,
  services: Readonly<Record<string, RoutedService>>,
  ingressUser: string,
  ingressPassword: string,
): string {
  const routerLines: string[] = [];
  const serviceLines: string[] = [];
  for (const [name, service] of Object.entries(services)) {
    routerLines.push(`    ${name}:
      rule: 'Host(\`${name}.${domain}\`)'
      entryPoints: [websecure]
      service: ${name}
      tls: {}
${service.requiresIngressAuthentication ? "      middlewares: [admin-auth]" : ""}`);
    serviceLines.push(`    ${name}:
      loadBalancer:
        servers:
          - url: "${service.url}"`);
  }
  routerLines.push(`    traefik-dashboard:
      rule: 'Host(\`traefik.${domain}\`)'
      entryPoints: [websecure]
      service: api@internal
      middlewares: [admin-auth]
      tls: {}`);
  const passwordHash = createHash("sha1")
    .update(ingressPassword)
    .digest("base64");
  return `http:
  middlewares:
    admin-auth:
      basicAuth:
        removeHeader: true
        users:
          - "${ingressUser}:{SHA}${passwordHash}"
  routers:
${routerLines.join("\n")}
  services:
${serviceLines.join("\n")}
`;
}

export const fail2banFilter = `[Definition]
failregex = ^<HOST> .* "(GET|POST|HEAD).*" (401|403|429) .*
ignoreregex =
`;

const fail2banJail = `[traefik-auth]
enabled = true
filter = traefik-auth
logpath = /var/log/traefik/access.log
backend = polling
maxretry = 10
findtime = 10m
bantime = 1h
`;

const prometheusConfiguration = `global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ["localhost:9090"]
`;

function grafanaDatasource(prometheusUrl: string): string {
  return `apiVersion: 1
datasources:
  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: ${prometheusUrl}
    isDefault: true
    editable: false
`;
}

export async function bootstrap(): Promise<void> {
  log.info("Starting deterministic bootstrap");
  validateConfiguration(process.env);
  await Promise.all(
    dataDirectories.map((path) => mkdir(`/data/${path}`, { recursive: true })),
  );
  for (const directory of runtimeDirectoryPlan()) {
    await mkdir(directory.path, { recursive: true });
    await chown(directory.path, directory.uid, directory.gid);
  }
  await installJellyfinPlugins();

  const password = required("QBITTORRENT_PASSWORD");
  const qbitCreated = await writeOnce(
    "/data/qbittorrent/qBittorrent/qBittorrent.conf",
    qBittorrentConfig(password),
  );
  log.info("qBittorrent bootstrap reconciled", { created: qbitCreated });

  for (const service of arrServices) {
    const created = await writeOnce(
      `/data/${service.name}/config.xml`,
      arrConfig(service),
    );
    log.info("Arr API bootstrap reconciled", {
      service: service.name,
      created,
    });
  }

  const services = routedServices();
  const domain = optional("TRAEFIK_DOMAIN", "192.168.0.15.nip.io");
  const ingressUser = required("INGRESS_ADMIN_USER");
  const ingressPassword = required("INGRESS_ADMIN_PASSWORD");
  await Promise.all([
    writeIfChanged(
      "/data/traefik/dynamic/services.yml",
      traefikDynamicConfiguration(
        domain,
        services,
        ingressUser,
        ingressPassword,
      ),
      0o644,
    ),
    writeIfChanged(
      "/data/fail2ban/filter.d/traefik-auth.conf",
      fail2banFilter,
      0o644,
    ),
    writeIfChanged(
      "/data/fail2ban/jail.d/traefik.conf",
      fail2banJail,
      0o644,
    ),
    writeIfChanged(
      "/data/prometheus-config/prometheus.yml",
      prometheusConfiguration,
      0o644,
    ),
    writeIfChanged(
      "/data/grafana-provisioning/datasources/prometheus.yml",
      grafanaDatasource(
        services.prometheus?.url ?? "http://prometheus:9090",
      ),
      0o644,
    ),
  ]);
  await writeBootstrapStatus();
  log.info("Bootstrap completed");
}
