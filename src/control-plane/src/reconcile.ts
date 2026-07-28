import {
  readArrApiKey,
  readBazarrApiKey,
  readJellyseerrApiKey,
} from "./api-key.js";
import { ArrClient } from "./arr.js";
import { BazarrClient } from "./bazarr.js";
import {
  boolean,
  integer,
  optional,
  required,
} from "./environment.js";
import { waitForHttp } from "./http.js";
import { JellyfinClient } from "./jellyfin.js";
import { JellyseerrClient } from "./jellyseerr.js";
import { log } from "./log.js";
import { ProwlarrClient } from "./prowlarr.js";
import { QBittorrentClient } from "./qbittorrent.js";
import { reconcileRecyclarr } from "./recyclarr.js";

interface ServiceUrls {
  readonly gluetunProxy: string;
  readonly sonarr: string;
  readonly radarr: string;
  readonly lidarr: string;
  readonly prowlarr: string;
  readonly bazarr: string;
  readonly jellyfin: string;
  readonly jellyseerr: string;
  readonly qbittorrent: string;
}

async function integration(
  name: string,
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
    log.info("Integration reconciled", { integration: name });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} reconciliation failed: ${message}`, {
      cause: error,
    });
  }
}

function loadServiceUrls(): ServiceUrls {
  return {
    gluetunProxy: required("GLUETUN_PROXY_URL"),
    sonarr: required("SONARR_URL"),
    radarr: required("RADARR_URL"),
    lidarr: required("LIDARR_URL"),
    prowlarr: required("PROWLARR_URL"),
    bazarr: required("BAZARR_URL"),
    jellyfin: required("JELLYFIN_URL"),
    jellyseerr: required("JELLYSEERR_URL"),
    qbittorrent: required("QBITTORRENT_URL"),
  };
}

async function waitForServices(urls: ServiceUrls): Promise<void> {
  await Promise.all([
    waitForHttp("qBittorrent", `${urls.qbittorrent}/`),
    waitForHttp("Sonarr", `${urls.sonarr}/ping`),
    waitForHttp("Radarr", `${urls.radarr}/ping`),
    waitForHttp("Lidarr", `${urls.lidarr}/ping`),
    waitForHttp("Prowlarr", `${urls.prowlarr}/ping`),
    waitForHttp("Bazarr", `${urls.bazarr}/`),
    waitForHttp("Jellyfin", `${urls.jellyfin}/health`),
    waitForHttp("Jellyseerr", `${urls.jellyseerr}/api/v1/status`),
  ]);
}

export async function reconcile(): Promise<void> {
  const urls = loadServiceUrls();
  const jellyfinUser = required("JELLYFIN_ADMIN_USER");
  const jellyfinPassword = required("JELLYFIN_ADMIN_PASSWORD");
  const qbittorrentPassword = required("QBITTORRENT_PASSWORD");
  const minimumSeeders = integer("MINIMUM_SEEDERS", 1);
  const useOriginalTitle = boolean("USE_ORIGINAL_TITLE", false);
  const languages = required("SUBTITLE_LANGUAGES")
    .split(",")
    .map((language) => language.trim())
    .filter(Boolean);

  log.info("Waiting for the real service APIs");
  await waitForServices(urls);

  const [
    sonarrKey,
    radarrKey,
    lidarrKey,
    prowlarrKey,
    bazarrKey,
    jellyseerrKey,
  ] =
    await Promise.all([
      readArrApiKey("sonarr"),
      readArrApiKey("radarr"),
      readArrApiKey("lidarr"),
      readArrApiKey("prowlarr"),
      readBazarrApiKey(),
      readJellyseerrApiKey(),
    ]);

  const qbittorrent = new QBittorrentClient(
    urls.qbittorrent,
    "admin",
    qbittorrentPassword,
  );
  const jellyfin = new JellyfinClient(
    urls.jellyfin,
    jellyfinUser,
    jellyfinPassword,
    required("JELLYFIN_SERVER_NAME"),
    required("JELLYFIN_LANGUAGE"),
  );
  await Promise.all([
    qbittorrent.reconcile(urls.gluetunProxy),
    jellyfin.reconcile({
      bazarrUrl: urls.bazarr,
      bazarrApiKey: bazarrKey,
      jellyseerrUrl: urls.jellyseerr,
      jellyseerrApiKey: jellyseerrKey,
      sonarrUrl: urls.sonarr,
      sonarrApiKey: sonarrKey,
      radarrUrl: urls.radarr,
      radarrApiKey: radarrKey,
    }),
  ]);

  const arrClients = [
    {
      name: "sonarr",
      client: new ArrClient({
        name: "sonarr",
        baseUrl: urls.sonarr,
        apiVersion: "v3",
        apiKey: sonarrKey,
        rootFolder: "/tv",
        category: "sonarr",
      }),
    },
    {
      name: "radarr",
      client: new ArrClient({
        name: "radarr",
        baseUrl: urls.radarr,
        apiVersion: "v3",
        apiKey: radarrKey,
        rootFolder: "/movies",
        category: "radarr",
      }),
    },
    {
      name: "lidarr",
      client: new ArrClient({
        name: "lidarr",
        baseUrl: urls.lidarr,
        apiVersion: "v1",
        apiKey: lidarrKey,
        rootFolder: "/music",
        category: "lidarr",
      }),
    },
  ] as const;
  await Promise.all(
    arrClients.map(({ name, client }) =>
      integration(name, () =>
        client.reconcile(
          urls.qbittorrent,
          qbittorrentPassword,
          minimumSeeders,
          useOriginalTitle,
        ),
      ),
    ),
  );

  const prowlarr = new ProwlarrClient(urls.prowlarr, prowlarrKey);
  const bazarr = new BazarrClient(urls.bazarr, bazarrKey);
  const jellyseerr = new JellyseerrClient(
    urls.jellyseerr,
    urls.jellyfin,
    jellyfinUser,
    jellyfinPassword,
  );
  await Promise.all([
    integration("prowlarr", () =>
      prowlarr.reconcile(urls.gluetunProxy, [
        {
          name: "Sonarr",
          url: urls.sonarr,
          apiKey: sonarrKey,
          categories: [5000, 5010, 5020, 5030, 5040, 5045, 5050],
        },
        {
          name: "Radarr",
          url: urls.radarr,
          apiKey: radarrKey,
          categories: [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060],
        },
        {
          name: "Lidarr",
          url: urls.lidarr,
          apiKey: lidarrKey,
          categories: [3000, 3010, 3020, 3030, 3040],
        },
      ]),
    ),
    integration("bazarr", () =>
      bazarr.reconcile(
        urls.sonarr,
        sonarrKey,
        urls.radarr,
        radarrKey,
        languages,
        {
          opensubtitlesComUser: optional("OPENSUBTITLESCOM_USER"),
          opensubtitlesComPassword: optional("OPENSUBTITLESCOM_PASSWORD"),
          opensubtitlesOrgUser: optional("OPENSUBTITLESORG_USER"),
          opensubtitlesOrgPassword: optional("OPENSUBTITLESORG_PASSWORD"),
          legendasDivxUser: optional("LEGENDASDIVX_USER"),
          legendasDivxPassword: optional("LEGENDASDIVX_PASSWORD"),
          legendasNetUser: optional("LEGENDASNET_USER"),
          legendasNetPassword: optional("LEGENDASNET_PASSWORD"),
        },
      ),
    ),
    integration("jellyseerr", () =>
      jellyseerr.reconcile(
        urls.sonarr,
        sonarrKey,
        urls.radarr,
        radarrKey,
      ),
    ),
    integration("recyclarr", () =>
      reconcileRecyclarr(urls.sonarr, sonarrKey, urls.radarr, radarrKey),
    ),
  ]);

  log.info("All Arrspire integrations are reconciled");
}
