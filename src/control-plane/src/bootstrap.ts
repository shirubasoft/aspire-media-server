import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { optional, required } from "./environment.js";
import { writeIfChanged, writeOnce } from "./files.js";
import { installJellyfinPlugins } from "./jellyfin-plugins.js";
import { log } from "./log.js";

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

function routedServices(): Readonly<Record<string, string>> {
  return {
    bazarr: required("BAZARR_URL"),
    grafana: required("GRAFANA_URL"),
    jellyfin: required("JELLYFIN_URL"),
    jellyseerr: required("JELLYSEERR_URL"),
    lidarr: required("LIDARR_URL"),
    prometheus: required("PROMETHEUS_URL"),
    prowlarr: required("PROWLARR_URL"),
    qbittorrent: required("QBITTORRENT_URL"),
    radarr: required("RADARR_URL"),
    sonarr: required("SONARR_URL"),
  };
}

function traefikDynamicConfiguration(
  domain: string,
  services: Readonly<Record<string, string>>,
): string {
  const routerLines: string[] = [];
  const serviceLines: string[] = [];
  for (const [name, url] of Object.entries(services)) {
    routerLines.push(`    ${name}:
      rule: 'Host(\`${name}.${domain}\`)'
      entryPoints: [web]
      service: ${name}`);
    serviceLines.push(`    ${name}:
      loadBalancer:
        servers:
          - url: "${url}"`);
  }
  return `http:
  routers:
${routerLines.join("\n")}
  services:
${serviceLines.join("\n")}
`;
}

const fail2banFilter = `[Definition]
failregex = ^<HOST> .* "(GET|POST|HEAD).*" (401|403|404|429) .*
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
  await Promise.all(
    dataDirectories.map((path) => mkdir(`/data/${path}`, { recursive: true })),
  );
  await Promise.all([
    mkdir("/media/movies", { recursive: true }),
    mkdir("/media/tv", { recursive: true }),
    mkdir("/media/music", { recursive: true }),
    mkdir("/downloads/incomplete", { recursive: true }),
  ]);
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
  const domain = optional("TRAEFIK_DOMAIN", "localhost");
  await Promise.all([
    writeIfChanged(
      "/data/traefik/dynamic/services.yml",
      traefikDynamicConfiguration(domain, services),
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
      grafanaDatasource(services.prometheus ?? "http://prometheus:9090"),
      0o644,
    ),
  ]);
  log.info("Bootstrap completed");
}
