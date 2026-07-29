import { access, readFile, readdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";

import {
  readArrApiKey,
  readBazarrApiKey,
  readJellyseerrApiKey,
} from "./api-key.js";
import { required } from "./environment.js";
import { form, json, request } from "./http.js";
import { log } from "./log.js";

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
    sonarr: "/tv",
    radarr: "/movies",
    lidarr: "/music",
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
  const [clients, roots] = await Promise.all([
    json<ArrEntity[]>(`${baseUrl}/api/${apiVersion}/downloadclient`, {
      headers,
    }),
    json<JsonObject[]>(`${baseUrl}/api/${apiVersion}/rootfolder`, { headers }),
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
}

async function verifyProwlarr(apiKey: string): Promise<void> {
  const baseUrl = endpoint("prowlarr");
  const headers = apiHeaders(apiKey);
  const [host, applications] = await Promise.all([
    json<JsonObject>(`${baseUrl}/api/v1/config/host`, { headers }),
    json<ArrEntity[]>(`${baseUrl}/api/v1/applications`, { headers }),
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

async function verifyJellyseerr(apiKey: string): Promise<void> {
  const baseUrl = endpoint("jellyseerr");
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
    json<Array<{ readonly isDefault?: boolean }>>(
      `${baseUrl}/api/v1/settings/sonarr`,
      { headers },
    ),
    json<Array<{ readonly isDefault?: boolean }>>(
      `${baseUrl}/api/v1/settings/radarr`,
      { headers },
    ),
  ]);
  ensure(publicSettings.initialized, "Jellyseerr is not initialized");
  const jellyfinUrl = new URL(endpoint("jellyfin"));
  ensure(
    jellyfinSettings.ip === jellyfinUrl.hostname &&
      jellyfinSettings.port === Number(jellyfinUrl.port || 8096) &&
      jellyfinSettings.useSsl === (jellyfinUrl.protocol === "https:"),
    "Jellyseerr Jellyfin endpoint is not reconciled",
  );
  ensure(
    sonarr.some((service) => service.isDefault),
    "Jellyseerr has no default Sonarr",
  );
  ensure(
    radarr.some((service) => service.isDefault),
    "Jellyseerr has no default Radarr",
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
    "Jellyseerr could not authenticate through its configured Jellyfin server",
  );
}

export async function verifyAcceptance(): Promise<void> {
  log.info("Starting real-stack acceptance checks");
  const [sonarrKey, radarrKey, lidarrKey, prowlarrKey, bazarrKey, jellyseerrKey] =
    await Promise.all([
      readArrApiKey("sonarr"),
      readArrApiKey("radarr"),
      readArrApiKey("lidarr"),
      readArrApiKey("prowlarr"),
      readBazarrApiKey(),
      readJellyseerrApiKey(),
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
    verifyJellyseerr(jellyseerrKey),
  ]);
  log.info("All real-stack acceptance checks passed");
}
