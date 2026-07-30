import { access, readFile, readdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";

import {
  readArrApiKey,
  readBazarrApiKey,
  readSeerrApiKey,
} from "./api-key.js";
import { integer, required } from "./environment.js";
import { form, json, request } from "./http.js";
import { log } from "./log.js";
import { publicServiceUrl } from "./public-url.js";

type JsonObject = Record<string, unknown>;

interface Field {
  readonly name?: string;
  readonly value?: unknown;
}

interface ArrEntity extends JsonObject {
  readonly implementation?: string;
  readonly fields?: readonly Field[];
}

interface JellyfinPlugin {
  readonly Id?: string;
  readonly Name?: string;
}

interface QualityItem {
  readonly allowed?: boolean;
  readonly quality?: {
    readonly name?: string;
  };
  readonly items?: readonly QualityItem[];
}

interface QualityProfile extends JsonObject {
  readonly name?: string;
  readonly upgradeAllowed?: boolean;
  readonly items?: readonly QualityItem[];
}

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Acceptance check failed: ${message}`);
  }
}

function endpoint(name: string): string {
  return required(`${name.toUpperCase()}_URL`);
}

function apiHeaders(apiKey: string): Readonly<Record<string, string>> {
  return { "X-Api-Key": apiKey };
}

async function verifyBootstrapFiles(): Promise<void> {
  const files = [
    "/data/fail2ban/filter.d/traefik-auth.conf",
    "/data/fail2ban/jail.d/traefik.conf",
    "/data/grafana-provisioning/datasources/prometheus.yml",
    "/data/homepage/bookmarks.yaml",
    "/data/homepage/custom.css",
    "/data/homepage/custom.js",
    "/data/homepage/docker.yaml",
    "/data/homepage/kubernetes.yaml",
    "/data/homepage/proxmox.yaml",
    "/data/homepage/services.yaml",
    "/data/homepage/settings.yaml",
    "/data/homepage/widgets.yaml",
    "/data/prometheus-config/prometheus.yml",
    "/data/recyclarr/recyclarr.yml",
    "/data/status/bootstrap.json",
    "/data/status/reconciliation.json",
    "/data/traefik/dynamic/services.yml",
  ] as const;
  await Promise.all(files.map((path) => access(path)));

  const recyclarr = await readFile("/data/recyclarr/recyclarr.yml", "utf8");
  ensure(
    recyclarr.includes("sonarr:") &&
      recyclarr.includes("radarr:") &&
      recyclarr.includes("delete_old_custom_formats: true"),
    "Recyclarr configuration is incomplete",
  );

  const ingress = await readFile(
    "/data/traefik/dynamic/services.yml",
    "utf8",
  );
  ensure(
    ingress.includes(`Host(\`${required("TRAEFIK_DOMAIN")}\`)`) &&
      ingress.includes("Host(`aspire.") &&
      ingress.includes("http://arrspire-dashboard:18888"),
    "Arrspire home or the Aspire dashboard is not protected by ingress",
  );

  const pluginDirectories = await readdir("/data/jellyfin/plugins");
  for (const plugin of [
    "Bazarr_",
    "FileTransformation_",
    "IntroSkipper_",
    "JellyfinEnhanced_",
    "TheTVDB_",
  ]) {
    ensure(
      pluginDirectories.some((directory) => directory.startsWith(plugin)),
      `Jellyfin plugin directory ${plugin} is missing`,
    );
  }
}

async function verifyIngressAuthentication(): Promise<void> {
  const ingress = new URL(endpoint("ingress"));
  const domain = required("TRAEFIK_DOMAIN");
  const status = await new Promise<number>((resolve, reject) => {
    const request = httpsRequest(
      {
        hostname: ingress.hostname,
        port: ingress.port || 443,
        path: "/",
        method: "GET",
        headers: { Host: `sonarr.${domain}` },
        rejectUnauthorized: false,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.once("error", reject);
    request.end();
  });
  ensure(
    status === 401,
    `Traefik administrative ingress accepted an unauthenticated request (${String(status)})`,
  );
}

async function verifyQBittorrent(baseUrl: string): Promise<void> {
  const response = await request(`${baseUrl}/api/v2/auth/login`, {
    method: "POST",
    body: form({
      username: "admin",
      password: required("QBITTORRENT_PASSWORD"),
    }),
    expected: [200, 204],
  });
  const cookie =
    /^(?:(?:QBT_)?SID(?:_[^=;]+)?=[^;]+)/u.exec(
      response.headers.get("set-cookie") ?? "",
    )?.[0] ?? "";
  ensure(cookie, "qBittorrent did not authenticate");
  const headers = {
    Cookie: cookie,
    Referer: `${baseUrl}/`,
    Origin: baseUrl,
  };
  const [preferences, categories] = await Promise.all([
    json<JsonObject>(`${baseUrl}/api/v2/app/preferences`, { headers }),
    json<Record<string, { readonly savePath?: string }>>(
      `${baseUrl}/api/v2/torrents/categories`,
      { headers },
    ),
  ]);
  ensure(
    preferences.proxy_type === "None",
    "qBittorrent has a redundant application proxy despite VPN networking",
  );
  ensure(
    preferences.proxy_peer_connections === false,
    "qBittorrent peer traffic is still forced through an HTTP proxy",
  );
  ensure(
    preferences.proxy_bittorrent === false,
    "qBittorrent tracker traffic is still forced through an HTTP proxy",
  );
  for (const [name, path] of Object.entries({
    sonarr: "/downloads/sonarr",
    radarr: "/downloads/radarr",
    lidarr: "/downloads/lidarr",
  })) {
    ensure(
      categories[name]?.savePath === path,
      `qBittorrent ${name} category is not configured`,
    );
  }
}

async function verifyArr(
  name: "sonarr" | "radarr" | "lidarr",
  apiVersion: "v1" | "v3",
  apiKey: string,
  rootFolder: string,
): Promise<void> {
  const baseUrl = endpoint(name);
  const headers = apiHeaders(apiKey);
  const [clients, roots, profiles] = await Promise.all([
    json<ArrEntity[]>(`${baseUrl}/api/${apiVersion}/downloadclient`, {
      headers,
    }),
    json<JsonObject[]>(`${baseUrl}/api/${apiVersion}/rootfolder`, { headers }),
    json<QualityProfile[]>(`${baseUrl}/api/${apiVersion}/qualityprofile`, {
      headers,
    }),
  ]);
  const qbit = clients.find(
    (client) => client.implementation === "QBittorrent",
  );
  ensure(qbit, `${name} has no qBittorrent download client`);
  const values = Object.fromEntries(
    (qbit.fields ?? [])
      .filter((field): field is Field & { readonly name: string } =>
        Boolean(field.name),
      )
      .map((field) => [field.name, field.value]),
  );
  ensure(values.username === "admin", `${name} qBittorrent user is incorrect`);
  ensure(
    roots.some((root) => root.path === rootFolder),
    `${name} root folder ${rootFolder} is missing`,
  );
  if (name === "sonarr") {
    const anime = profiles.find(
      (profile) => profile.name === "[Anime] Remux-1080p",
    );
    ensure(anime, "Sonarr anime Blu-ray quality profile is missing");
    ensure(
      anime.upgradeAllowed === true,
      "Sonarr anime profile does not permit quality upgrades",
    );
    const qualityNames = (anime.items ?? []).flatMap(function names(
      item,
    ): string[] {
      return [
        ...(item.allowed === true && item.quality?.name
          ? [item.quality.name]
          : []),
        ...(item.items ?? []).flatMap(names),
      ];
    });
    ensure(
      qualityNames.some((quality) => quality.startsWith("Bluray-")),
      "Sonarr anime profile has no enabled Blu-ray quality",
    );
  }
}

async function verifyProwlarr(apiKey: string): Promise<void> {
  const baseUrl = endpoint("prowlarr");
  const headers = apiHeaders(apiKey);
  const [host, applications, indexers] = await Promise.all([
    json<JsonObject>(`${baseUrl}/api/v1/config/host`, { headers }),
    json<ArrEntity[]>(`${baseUrl}/api/v1/applications`, { headers }),
    json<JsonObject[]>(`${baseUrl}/api/v1/indexer`, { headers }),
  ]);
  ensure(host.proxyEnabled === true, "Prowlarr VPN proxy is disabled");
  for (const application of ["Sonarr", "Radarr", "Lidarr"]) {
    ensure(
      applications.some(
        (candidate) => candidate.implementation === application,
      ),
      `Prowlarr ${application} application is missing`,
    );
  }
  const sonarr = applications.find(
    (application) => application.implementation === "Sonarr",
  );
  const sonarrFields = Object.fromEntries(
    (sonarr?.fields ?? [])
      .filter((field): field is Field & { readonly name: string } =>
        Boolean(field.name),
      )
      .map((field) => [field.name, field.value]),
  );
  ensure(
    Array.isArray(sonarrFields.animeSyncCategories) &&
      sonarrFields.animeSyncCategories.includes(5070),
    "Prowlarr does not synchronize the anime category to Sonarr",
  );
  ensure(
    indexers.some(
      (indexer) => indexer.name === "Knaben" && indexer.enable === true,
    ),
    "Prowlarr Knaben music indexer is missing or disabled",
  );
}

async function verifyBazarr(apiKey: string): Promise<void> {
  const settings = await json<{
    readonly general?: JsonObject;
    readonly sonarr?: JsonObject;
    readonly radarr?: JsonObject;
  }>(`${endpoint("bazarr")}/api/system/settings`, {
    headers: { "X-API-KEY": apiKey },
  });
  ensure(settings.general?.use_sonarr === true, "Bazarr Sonarr is disabled");
  ensure(settings.general?.use_radarr === true, "Bazarr Radarr is disabled");
  ensure(
    Array.isArray(settings.general?.enabled_providers) &&
      settings.general.enabled_providers.includes("podnapisi"),
    "Bazarr has no deterministic subtitle provider",
  );
}

function jellyfinAuthorization(token = ""): string {
  const base =
    'MediaBrowser Client="Arrspire", Device="Acceptance", DeviceId="arrspire-acceptance", Version="1.0.0"';
  return token ? `${base}, Token="${token}"` : base;
}

async function verifyJellyfin(): Promise<void> {
  const baseUrl = endpoint("jellyfin");
  const authentication = await json<{ readonly AccessToken?: string }>(
    `${baseUrl}/Users/AuthenticateByName`,
    {
      method: "POST",
      headers: {
        Authorization: jellyfinAuthorization(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Username: required("JELLYFIN_ADMIN_USER"),
        Pw: required("JELLYFIN_ADMIN_PASSWORD"),
      }),
    },
  );
  ensure(authentication.AccessToken, "Jellyfin admin authentication failed");
  const headers = {
    Authorization: jellyfinAuthorization(authentication.AccessToken),
  };
  const [info, libraries, plugins, repositories, tasks] = await Promise.all([
    json<{ readonly StartupWizardCompleted?: boolean }>(
      `${baseUrl}/System/Info/Public`,
    ),
    json<Array<{ readonly CollectionType?: string }>>(
      `${baseUrl}/Library/VirtualFolders`,
      { headers },
    ),
    json<JellyfinPlugin[]>(`${baseUrl}/Plugins`, { headers }),
    json<Array<{ readonly Url?: string }>>(`${baseUrl}/Repositories`, {
      headers,
    }),
    json<Array<{ readonly Name?: string; readonly Key?: string }>>(
      `${baseUrl}/ScheduledTasks`,
      { headers },
    ),
  ]);
  ensure(info.StartupWizardCompleted, "Jellyfin startup wizard is incomplete");
  for (const type of ["movies", "tvshows", "music"]) {
    ensure(
      libraries.some((library) => library.CollectionType === type),
      `Jellyfin ${type} library is missing`,
    );
  }
  for (const pluginName of [
    "Bazarr",
    "File Transformation",
    "Intro Skipper",
    "Jellyfin Enhanced",
    "TheTVDB",
  ]) {
    ensure(
      plugins.some((plugin) =>
        plugin.Name?.toLowerCase().includes(pluginName.toLowerCase()),
      ),
      `Jellyfin plugin ${pluginName} is not loaded`,
    );
  }
  ensure(
    repositories.some((repository) =>
      repository.Url?.includes("intro-skipper"),
    ),
    "Jellyfin plugin repositories are not reconciled",
  );
  ensure(
    tasks.some((task) =>
      `${task.Name ?? ""} ${task.Key ?? ""}`
        .toLowerCase()
        .includes("intro"),
    ),
    "Jellyfin Intro Skipper task is not registered",
  );
}

async function verifySeerr(apiKey: string): Promise<void> {
  const baseUrl = endpoint("seerr");
  const headers = apiHeaders(apiKey);
  const [publicSettings, jellyfinSettings, sonarr, radarr] = await Promise.all([
    json<{ readonly initialized?: boolean }>(
      `${baseUrl}/api/v1/settings/public`,
    ),
    json<{
      readonly ip?: string;
      readonly port?: number;
      readonly useSsl?: boolean;
      readonly urlBase?: string;
    }>(
      `${baseUrl}/api/v1/settings/jellyfin`,
      { headers },
    ),
    json<
      Array<{
        readonly isDefault?: boolean;
        readonly hostname?: string;
        readonly port?: number;
        readonly useSsl?: boolean;
        readonly animeSeriesType?: string;
        readonly activeAnimeProfileName?: string;
        readonly activeAnimeDirectory?: string;
        readonly externalUrl?: string;
      }>
    >(
      `${baseUrl}/api/v1/settings/sonarr`,
      { headers },
    ),
    json<Array<{
      readonly isDefault?: boolean;
      readonly hostname?: string;
      readonly port?: number;
      readonly useSsl?: boolean;
      readonly externalUrl?: string;
    }>>(
      `${baseUrl}/api/v1/settings/radarr`,
      { headers },
    ),
  ]);
  ensure(publicSettings.initialized, "Seerr is not initialized");
  const jellyfinUrl = new URL(endpoint("jellyfin"));
  ensure(
    jellyfinSettings.ip === jellyfinUrl.hostname &&
      jellyfinSettings.port === Number(jellyfinUrl.port || 8096) &&
      jellyfinSettings.useSsl === (jellyfinUrl.protocol === "https:"),
    "Seerr Jellyfin endpoint is not reconciled",
  );
  const defaultSonarr = sonarr.find((service) => service.isDefault);
  ensure(defaultSonarr, "Seerr has no default Sonarr");
  const sonarrUrl = new URL(endpoint("sonarr"));
  const domain = required("TRAEFIK_DOMAIN");
  const ingressHttpsPort = integer("INGRESS_HTTPS_PORT", 443);
  ensure(
    defaultSonarr.hostname === sonarrUrl.hostname &&
      defaultSonarr.port === Number(sonarrUrl.port || 8989) &&
      defaultSonarr.useSsl === (sonarrUrl.protocol === "https:"),
    "Seerr Sonarr internal endpoint is not reconciled",
  );
  ensure(
    defaultSonarr.externalUrl ===
      publicServiceUrl("sonarr", domain, ingressHttpsPort),
    "Seerr Sonarr external URL is not reconciled",
  );
  ensure(
    defaultSonarr.animeSeriesType === "anime" &&
      defaultSonarr.activeAnimeProfileName === "[Anime] Remux-1080p" &&
      defaultSonarr.activeAnimeDirectory === "/tv",
    "Seerr does not use the anime Blu-ray profile for anime requests",
  );
  const defaultRadarr = radarr.find((service) => service.isDefault);
  ensure(defaultRadarr, "Seerr has no default Radarr");
  const radarrUrl = new URL(endpoint("radarr"));
  ensure(
    defaultRadarr.hostname === radarrUrl.hostname &&
      defaultRadarr.port === Number(radarrUrl.port || 7878) &&
      defaultRadarr.useSsl === (radarrUrl.protocol === "https:"),
    "Seerr Radarr internal endpoint is not reconciled",
  );
  ensure(
    defaultRadarr.externalUrl ===
      publicServiceUrl("radarr", domain, ingressHttpsPort),
    "Seerr Radarr external URL is not reconciled",
  );
  const authentication = await request(
    `${baseUrl}/api/v1/auth/jellyfin`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: required("JELLYFIN_ADMIN_USER"),
        password: required("JELLYFIN_ADMIN_PASSWORD"),
      }),
    },
  );
  ensure(
    authentication.headers.get("set-cookie"),
    "Seerr could not authenticate through its configured Jellyfin server",
  );
}

export async function verifyAcceptance(): Promise<void> {
  log.info("Starting real-stack acceptance checks");
  const [sonarrKey, radarrKey, lidarrKey, prowlarrKey, bazarrKey, seerrKey] =
    await Promise.all([
      readArrApiKey("sonarr"),
      readArrApiKey("radarr"),
      readArrApiKey("lidarr"),
      readArrApiKey("prowlarr"),
      readBazarrApiKey(),
      readSeerrApiKey(),
    ]);

  await Promise.all([
    verifyBootstrapFiles(),
    verifyIngressAuthentication(),
    verifyQBittorrent(endpoint("qbittorrent")),
    verifyArr("sonarr", "v3", sonarrKey, "/tv"),
    verifyArr("radarr", "v3", radarrKey, "/movies"),
    verifyArr("lidarr", "v1", lidarrKey, "/music"),
    verifyProwlarr(prowlarrKey),
    verifyBazarr(bazarrKey),
    verifyJellyfin(),
    verifySeerr(seerrKey),
  ]);
  log.info("All real-stack acceptance checks passed");
}
