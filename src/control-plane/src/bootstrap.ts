import {
  createHash,
  pbkdf2Sync,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { chown, lchown, lstat, mkdir, opendir } from "node:fs/promises";
import { join } from "node:path";

import { integer, optional, required } from "./environment.js";
import { readArrApiKey } from "./api-key.js";
import { writeIfChanged, writeOnce } from "./files.js";
import { installJellyfinPlugins } from "./jellyfin-plugins.js";
import { log } from "./log.js";
import { reconcileRecyclarr } from "./recyclarr.js";
import {
  type AuthenticationMode,
  requiresIngressAuthentication,
  serviceSurface,
} from "./service-surfaces.js";
import { writeBootstrapStatus } from "./status.js";
import {
  resolveTraefikTlsMode,
  traefikRouterTlsConfiguration,
  type TraefikTlsMode,
} from "./traefik-tls.js";
import { validateConfiguration } from "./validation.js";

const dataDirectories = [
  "authelia/config",
  "authelia/secrets",
  "backups",
  "bazarr",
  "diun",
  "duplicati",
  "fail2ban/filter.d",
  "fail2ban/jail.d",
  "gluetun",
  "grafana",
  "grafana-provisioning/datasources",
  "homepage/secrets",
  "jellyfin",
  "jellyfin-cache",
  // Preserve the legacy data directory for Seerr's automatic migration.
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
  readonly recursive?: boolean;
}

export function runtimeDirectoryPlan(): readonly RuntimeDirectory[] {
  return [
    // The official Grafana image runs as UID 472 and GID 0.
    { path: "/data/grafana", uid: 472, gid: 0 },
    // Prometheus persists its TSDB as the image's nobody user.
    { path: "/data/prometheus", uid: 65_534, gid: 65_534 },
    // Recyclarr runs as UID/GID 1000 and needs to create its migration state
    // under /config when the scheduled job starts.
    { path: "/data/recyclarr", uid: 1000, gid: 1000 },
    // Seerr's official rootless image runs as UID/GID 1000. The legacy
    // Jellyseerr directory is intentionally retained for in-place migration.
    // Normalize its existing contents as well because the old image wrote
    // them as root, while Seerr needs to update the database and logs.
    { path: "/data/jellyseerr", uid: 1000, gid: 1000, recursive: true },
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

async function chownTree(path: string, uid: number, gid: number): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    await lchown(path, uid, gid);
    return;
  }

  await chown(path, uid, gid);
  if (!metadata.isDirectory()) {
    return;
  }

  const directory = await opendir(path);
  for await (const entry of directory) {
    await chownTree(join(path, entry.name), uid, gid);
  }
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
  readonly authentication: AuthenticationMode;
  readonly aliases?: readonly string[];
  readonly hosts?: readonly string[];
}

function routedServices(
  domain: string,
): Readonly<Record<string, RoutedService>> {
  return {
    auth: {
      url: required("AUTH_URL"),
      authentication: serviceSurface("auth").authentication,
    },
    aspire: {
      url: optional(
        "ASPIRE_DASHBOARD_URL",
        "http://arrspire-dashboard:18888",
      ),
      authentication: serviceSurface("aspire").authentication,
    },
    bazarr: {
      url: required("BAZARR_URL"),
      authentication: serviceSurface("bazarr").authentication,
    },
    duplicati: {
      url: required("DUPLICATI_URL"),
      // Duplicati authenticates API calls with a Bearer token. Keep those
      // requests out of the ingress authorization flow so Authelia never
      // interprets or replaces the service's Authorization header.
      authentication: serviceSurface("duplicati").authentication,
    },
    grafana: {
      url: required("GRAFANA_URL"),
      authentication: serviceSurface("grafana").authentication,
    },
    homepage: {
      url: required("HOMEPAGE_URL"),
      authentication: serviceSurface("home").authentication,
      hosts: [domain, `home.${domain}`],
    },
    jellyfin: {
      url: required("JELLYFIN_URL"),
      authentication: serviceSurface("jellyfin").authentication,
    },
    seerr: {
      url: required("SEERR_URL"),
      authentication: serviceSurface("seerr").authentication,
      aliases: ["jellyseerr"],
    },
    lidarr: {
      url: required("LIDARR_URL"),
      authentication: serviceSurface("lidarr").authentication,
    },
    prometheus: {
      url: required("PROMETHEUS_URL"),
      authentication: serviceSurface("prometheus").authentication,
    },
    prowlarr: {
      url: required("PROWLARR_URL"),
      authentication: serviceSurface("prowlarr").authentication,
    },
    qbittorrent: {
      url: required("QBITTORRENT_URL"),
      authentication: serviceSurface("qbittorrent").authentication,
    },
    radarr: {
      url: required("RADARR_URL"),
      authentication: serviceSurface("radarr").authentication,
    },
    sonarr: {
      url: required("SONARR_URL"),
      authentication: serviceSurface("sonarr").authentication,
    },
    tdarr: {
      url: required("TDARR_URL"),
      authentication: serviceSurface("tdarr").authentication,
    },
  };
}

export function traefikDynamicConfiguration(
  domain: string,
  services: Readonly<Record<string, RoutedService>>,
  autheliaUrl: string,
  tlsMode: TraefikTlsMode = "local",
): string {
  const routerLines: string[] = [];
  const serviceLines: string[] = [];
  const tlsConfiguration = traefikRouterTlsConfiguration(tlsMode);
  for (const [name, service] of Object.entries(services)) {
    const hostRules = (
      service.hosts ??
      [name, ...(service.aliases ?? [])].map(
        (hostname) => `${hostname}.${domain}`,
      )
    )
      .map((hostname) => `Host(\`${hostname}\`)`)
      .join(" || ");
    routerLines.push(`    ${name}:
      rule: '${hostRules}'
      entryPoints: [websecure]
      service: ${name}
${tlsConfiguration}
${requiresIngressAuthentication(service.authentication) ? "      middlewares: [admin-auth]" : ""}`);
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
${tlsConfiguration}`);
  const authorizationEndpoint = new URL(
    "/api/authz/forward-auth",
    `${autheliaUrl.replace(/\/+$/u, "")}/`,
  ).toString();
  return `http:
  middlewares:
    admin-auth:
      forwardAuth:
        address: ${yamlString(authorizationEndpoint)}
        trustForwardHeader: true
        maxResponseBodySize: 8192
        authResponseHeaders:
          - Remote-User
          - Remote-Groups
          - Remote-Email
          - Remote-Name
  routers:
${routerLines.join("\n")}
  services:
${serviceLines.join("\n")}
`;
}

export function autheliaPasswordDigest(
  password: string,
  saltSource: string,
): string {
  const iterations = 16;
  const blockSize = 8;
  const parallelism = 1;
  const cost = 2 ** iterations;
  const salt = createHash("sha256")
    .update("arrspire-authelia-password\u0000")
    .update(saltSource)
    .digest()
    .subarray(0, 16);
  const digest = scryptSync(password, salt, 32, {
    N: cost,
    r: blockSize,
    p: parallelism,
    maxmem: 128 * cost * blockSize + 2 * 1024 * 1024,
  });
  const encode = (value: Buffer): string =>
    value.toString("base64").replace(/=+$/u, "");
  return `$scrypt$ln=${String(iterations)},r=${String(blockSize)},p=${String(parallelism)}$${encode(salt)}$${encode(digest)}`;
}

export function autheliaUsersDatabase(
  username: string,
  password: string,
  sessionSecret: string,
  domain: string,
): string {
  return `users:
  ${yamlString(username)}:
    disabled: false
    displayname: "Arrspire Administrator"
    password: ${yamlString(
      autheliaPasswordDigest(password, `${sessionSecret}\u0000${username}`),
    )}
    email: ${yamlString(`arrspire@${domain}`)}
    groups:
      - admins
`;
}

export function autheliaConfiguration(
  domain: string,
  httpsPort: number,
): string {
  return `theme: auto
server:
  address: "tcp://:9091/"
  endpoints:
    authz:
      forward-auth:
        implementation: ForwardAuth
log:
  level: info
  format: text
authentication_backend:
  password_reset:
    disable: true
  password_change:
    disable: true
  file:
    path: /config/users_database.yml
    watch: false
access_control:
  default_policy: deny
  rules:
    - domain:
        - ${yamlString(domain)}
        - ${yamlString(`*.${domain}`)}
      policy: one_factor
session:
  name: arrspire_session
  same_site: lax
  inactivity: 1h
  expiration: 12h
  remember_me: 1M
  cookies:
    - domain: ${yamlString(domain)}
      authelia_url: ${yamlString(externalServiceUrl("auth", domain, httpsPort))}
      default_redirection_url: ${yamlString(
        externalRootUrl(domain, httpsPort),
      )}
storage:
  local:
    path: /config/db.sqlite3
notifier:
  filesystem:
    filename: /config/notification.txt
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

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function externalServiceUrl(
  service: string,
  domain: string,
  httpsPort: number,
): string {
  const port = httpsPort === 443 ? "" : `:${String(httpsPort)}`;
  return `https://${service}.${domain}${port}`;
}

function externalRootUrl(domain: string, httpsPort: number): string {
  const port = httpsPort === 443 ? "" : `:${String(httpsPort)}`;
  return `https://${domain}${port}`;
}

interface HomepageService {
  readonly name: string;
  readonly icon: string;
  readonly description: string;
  readonly internalUrl: string;
  readonly healthPath: string;
  readonly widget?: Readonly<{
    readonly type: string;
    readonly secretName?: string;
    readonly username?: string;
    readonly passwordSecretName?: string;
    readonly fields?: readonly string[];
  }>;
}

function homepageCard(
  service: HomepageService,
  domain: string,
  httpsPort: number,
): string {
  const lines = [
    `    - ${service.name}:`,
    `        icon: ${service.icon}`,
    `        href: ${yamlString(externalServiceUrl(service.name.toLowerCase(), domain, httpsPort))}`,
    `        description: ${yamlString(service.description)}`,
    `        siteMonitor: ${yamlString(`${service.internalUrl}${service.healthPath}`)}`,
  ];
  if (service.widget !== undefined) {
    lines.push(
      "        widget:",
      `          type: ${service.widget.type}`,
      `          url: ${yamlString(service.internalUrl)}`,
    );
    if (service.widget.secretName !== undefined) {
      lines.push(
        `          key: "{{HOMEPAGE_FILE_${service.widget.secretName}}}"`,
      );
    }
    if (service.widget.username !== undefined) {
      lines.push(`          username: ${service.widget.username}`);
    }
    if (service.widget.passwordSecretName !== undefined) {
      lines.push(
        `          password: "{{HOMEPAGE_FILE_${service.widget.passwordSecretName}}}"`,
      );
    }
    if (service.widget.fields !== undefined) {
      lines.push(
        `          fields: [${service.widget.fields.map(yamlString).join(", ")}]`,
      );
    }
  }
  return lines.join("\n");
}

export function homepageSettings(): string {
  return `title: Arrspire
description: Media, requests, automation, and operations
theme: dark
color: slate
headerStyle: boxedWidgets
statusStyle: dot
hideVersion: true
disableIndexing: true
target: _self
layout:
  Watch and Request:
    style: row
    columns: 2
  Library Automation:
    style: row
    columns: 4
  Downloads and Processing:
    style: row
    columns: 4
  Operations:
    style: row
    columns: 4
`;
}

export function homepageServices(
  domain: string,
  httpsPort: number,
  services: Readonly<Record<string, RoutedService>>,
): string {
  const card = (
    name: string,
    icon: string,
    description: string,
    healthPath: string,
    widget?: HomepageService["widget"],
  ): string =>
    homepageCard(
      {
        name,
        icon,
        description,
        internalUrl: services[name.toLowerCase()]?.url ?? "",
        healthPath,
        ...(widget === undefined ? {} : { widget }),
      },
      domain,
      httpsPort,
    );

  return `- Watch and Request:
${card("Jellyfin", "jellyfin.png", "Watch movies, series, and music", "/health")}
${card("Seerr", "seerr.png", "Request movies and series", "/api/v1/status")}

- Library Automation:
${card("Sonarr", "sonarr.png", "Series library", "/ping", { type: "sonarr", secretName: "SONARR_KEY", fields: ["wanted", "queued"] })}
${card("Radarr", "radarr.png", "Movie library", "/ping", { type: "radarr", secretName: "RADARR_KEY", fields: ["wanted", "queued"] })}
${card("Lidarr", "lidarr.png", "Music library", "/ping", { type: "lidarr", secretName: "LIDARR_KEY" })}
${card("Prowlarr", "prowlarr.png", "Indexer management", "/ping", { type: "prowlarr", secretName: "PROWLARR_KEY" })}

- Downloads and Processing:
${card("qBittorrent", "qbittorrent.png", "Download queue", "/", { type: "qbittorrent", username: "admin", passwordSecretName: "QBITTORRENT_PASSWORD" })}
${card("Bazarr", "bazarr.png", "Subtitle automation", "/")}
${card("Tdarr", "tdarr.png", "Media health and transcoding", "/api/v2/status", { type: "tdarr" })}
${card("Duplicati", "duplicati.png", "Configuration backups", "/ngclient/")}

- Operations:
${card("Grafana", "grafana.png", "Metrics dashboards", "/api/health")}
${card("Prometheus", "prometheus.png", "Metrics collection", "/-/healthy")}
${homepageCard(
  {
    name: "Aspire",
    icon: "microsoft-azure.png",
    description: "Resources, logs, traces, and commands",
    internalUrl: services.aspire?.url ?? "",
    healthPath: "/",
  },
  domain,
  httpsPort,
)}
${homepageCard(
  {
    name: "Traefik",
    icon: "traefik-proxy.png",
    description: "Ingress routes and TLS",
    internalUrl: "http://traefik:8080",
    healthPath: "/ping",
  },
  domain,
  httpsPort,
)}
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
    if (directory.recursive === true) {
      await chownTree(directory.path, directory.uid, directory.gid);
    } else {
      await chown(directory.path, directory.uid, directory.gid);
    }
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
  const domain = optional("TRAEFIK_DOMAIN", "192.168.0.15.nip.io");
  const httpsPort = integer("TRAEFIK_HTTPS_PORT", 443);
  const services = routedServices(domain);
  const [sonarrKey, radarrKey, lidarrKey, prowlarrKey] = await Promise.all([
    readArrApiKey("sonarr"),
    readArrApiKey("radarr"),
    readArrApiKey("lidarr"),
    readArrApiKey("prowlarr"),
  ]);
  await reconcileRecyclarr(
    required("SONARR_URL"),
    sonarrKey,
    required("RADARR_URL"),
    radarrKey,
  );

  const tlsMode = resolveTraefikTlsMode(process.env);
  const ingressUser = required("INGRESS_ADMIN_USER");
  const ingressPassword = required("INGRESS_ADMIN_PASSWORD");
  const autheliaSessionSecret = required("AUTHELIA_SESSION_SECRET");
  const autheliaStorageEncryptionKey = required(
    "AUTHELIA_STORAGE_ENCRYPTION_KEY",
  );
  await Promise.all([
    writeIfChanged(
      "/data/authelia/config/configuration.yml",
      autheliaConfiguration(domain, httpsPort),
      0o644,
    ),
    writeIfChanged(
      "/data/authelia/config/users_database.yml",
      autheliaUsersDatabase(
        ingressUser,
        ingressPassword,
        autheliaSessionSecret,
        domain,
      ),
    ),
    writeIfChanged(
      "/data/authelia/secrets/session-secret",
      autheliaSessionSecret,
    ),
    writeIfChanged(
      "/data/authelia/secrets/storage-encryption-key",
      autheliaStorageEncryptionKey,
    ),
    writeIfChanged(
      "/data/traefik/dynamic/services.yml",
      traefikDynamicConfiguration(
        domain,
        services,
        required("AUTH_URL"),
        tlsMode,
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
    writeIfChanged(
      "/data/homepage/settings.yaml",
      homepageSettings(),
      0o644,
    ),
    writeIfChanged(
      "/data/homepage/services.yaml",
      homepageServices(domain, httpsPort, services),
      0o644,
    ),
    writeIfChanged("/data/homepage/bookmarks.yaml", "[]\n", 0o644),
    writeIfChanged("/data/homepage/widgets.yaml", "[]\n", 0o644),
    writeIfChanged("/data/homepage/docker.yaml", "{}\n", 0o644),
    writeIfChanged("/data/homepage/kubernetes.yaml", "---\n", 0o644),
    writeIfChanged("/data/homepage/proxmox.yaml", "---\n", 0o644),
    writeIfChanged("/data/homepage/custom.css", "", 0o644),
    writeIfChanged("/data/homepage/custom.js", "", 0o644),
    writeIfChanged(
      "/data/homepage/secrets/sonarr-key",
      sonarrKey,
    ),
    writeIfChanged(
      "/data/homepage/secrets/radarr-key",
      radarrKey,
    ),
    writeIfChanged(
      "/data/homepage/secrets/lidarr-key",
      lidarrKey,
    ),
    writeIfChanged(
      "/data/homepage/secrets/prowlarr-key",
      prowlarrKey,
    ),
    writeIfChanged(
      "/data/homepage/secrets/qbittorrent-password",
      password,
    ),
  ]);
  await writeBootstrapStatus();
  log.info("Bootstrap completed");
}
