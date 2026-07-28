import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  ContainerLifetime,
  type ContainerResourcePromise,
  type DistributedApplicationBuilder,
  type EndpointReferencePromise,
} from "../.aspire/modules/aspire.mjs";
import type { ArrspireParameters } from "./parameters.mjs";
import {
  AcceptanceResource,
  BazarrResource,
  BootstrapResource,
  DiunResource,
  DuplicatiResource,
  Fail2banResource,
  GluetunResource,
  GrafanaResource,
  JellyfinResource,
  JellyseerrResource,
  LidarrResource,
  PrometheusResource,
  ProwlarrResource,
  QBittorrentResource,
  RadarrResource,
  ReconcilerResource,
  RecyclarrResource,
  SonarrResource,
  TdarrResource,
  TraefikResource,
} from "./resource-types.mjs";

export interface ArrspirePaths {
  readonly data: string;
  readonly media: string;
  readonly downloads: string;
  readonly containerSocket: string;
  readonly rootlessPodman: boolean;
}

export interface ArrspireTopology {
  readonly gluetun: GluetunResource;
  readonly qbittorrent: QBittorrentResource;
  readonly sonarr: SonarrResource;
  readonly radarr: RadarrResource;
  readonly lidarr: LidarrResource;
  readonly prowlarr: ProwlarrResource;
  readonly bazarr: BazarrResource;
  readonly jellyfin: JellyfinResource;
  readonly jellyseerr: JellyseerrResource;
  readonly recyclarr: RecyclarrResource;
  readonly duplicati: DuplicatiResource;
  readonly tdarr: TdarrResource;
  readonly traefik: TraefikResource;
  readonly fail2ban: Fail2banResource;
  readonly diun: DiunResource;
  readonly prometheus: PrometheusResource;
  readonly grafana: GrafanaResource;
  readonly bootstrap: BootstrapResource;
  readonly reconciler: ReconcilerResource;
  readonly acceptance?: AcceptanceResource;
}

export function resolveArrspirePaths(
  appHostDirectory: string,
  isRunMode: boolean,
): ArrspirePaths {
  const repositoryRoot = resolve(appHostDirectory, "..");
  const podmanSocket = `/run/user/${process.getuid?.().toString() ?? "1000"}/podman/podman.sock`;
  const podmanSocketAvailable =
    process.platform === "linux" &&
    !existsSync("/var/run/docker.sock") &&
    existsSync(podmanSocket);
  const rootlessPodman =
    isRunMode &&
    podmanSocketAvailable;
  return {
    data: process.env.ARRSPIRE_DATA_PATH ?? join(repositoryRoot, "data"),
    media: process.env.ARRSPIRE_MEDIA_PATH ?? join(homedir(), "media"),
    downloads:
      process.env.ARRSPIRE_DOWNLOADS_PATH ?? join(homedir(), "downloads"),
    containerSocket:
      process.env.ARRSPIRE_CONTAINER_SOCKET ??
      (podmanSocketAvailable ? podmanSocket : "/var/run/docker.sock"),
    rootlessPodman,
  };
}

function withLinuxServerDefaults(
  resource: ContainerResourcePromise,
  parameters: ArrspireParameters,
  rootlessPodman: boolean,
): ContainerResourcePromise {
  let configured = resource
    .withEnvironment("PUID", process.getuid?.().toString() ?? "1000")
    .withEnvironment("PGID", process.getgid?.().toString() ?? "1000")
    .withEnvironment("TZ", parameters.timezone);
  if (rootlessPodman) {
    configured = configured.withContainerRuntimeArgs(["--userns=keep-id"]);
  }
  return configured;
}

function exposeHttp(
  resource: ContainerResourcePromise,
  port: number,
  healthPath: string,
  endpointName = "http",
): ContainerResourcePromise {
  return resource
    .withHttpEndpoint({
      name: endpointName,
      port,
      targetPort: port,
    })
    .withHttpHealthCheck({
      endpointName,
      path: healthPath,
    })
    .withExternalHttpEndpoints();
}

async function withComposeRestart(
  resource: ContainerResourcePromise,
): Promise<void> {
  await resource.publishAsDockerComposeService(async (_compose, service) => {
    await service.restart.set("unless-stopped");
  });
}

async function shareComposeNetworkNamespace(
  resource: ContainerResourcePromise,
  ownerServiceName: string,
): Promise<void> {
  await resource.publishAsDockerComposeService(async (_compose, service) => {
    await service.networkMode.set(`service:${ownerServiceName}`);
    await service.ports.clear();
    await service.networks.clear();
    await service.restart.set("unless-stopped");
  });
}

export async function addArrspireTopology(
  builder: DistributedApplicationBuilder,
  parameters: ArrspireParameters,
  paths: ArrspirePaths,
  isRunMode: boolean,
): Promise<ArrspireTopology> {
  let gluetunContainer = builder
    .addContainer("gluetun", "docker.io/qmcgaw/gluetun:latest")
    .withEnvironment("VPN_SERVICE_PROVIDER", parameters.vpnProvider)
    .withEnvironment("VPN_TYPE", "wireguard")
    .withEnvironment("WIREGUARD_PRIVATE_KEY", parameters.vpnWireguardKey)
    .withEnvironment("SERVER_COUNTRIES", parameters.vpnCountries)
    .withEnvironment("TZ", parameters.timezone)
    .withEnvironment("HTTPPROXY", "on")
    .withEnvironment("HTTPPROXY_STEALTH", "on")
    .withBindMount(join(paths.data, "gluetun"), "/gluetun")
    .withContainerRuntimeArgs([
      "--cap-add=NET_ADMIN",
      "--device=/dev/net/tun:/dev/net/tun",
    ])
    .withHttpEndpoint({
      name: "control",
      targetPort: 8000,
    })
    .withHttpEndpoint({
      name: "http-proxy",
      targetPort: 8888,
    });

  if (!isRunMode) {
    gluetunContainer = gluetunContainer
      .withEndpoint({
        name: "qbittorrent",
        scheme: "http",
        port: 8080,
        targetPort: 8080,
        isExternal: true,
      })
      .withEndpoint({
        name: "prowlarr",
        scheme: "http",
        port: 9696,
        targetPort: 9696,
        isExternal: true,
      });
  }

  const gluetun = new GluetunResource(
    "gluetun",
    gluetunContainer,
  );

  await gluetun.resource.publishAsDockerComposeService(
    async (_compose, service) => {
      await service.capAdd.add("NET_ADMIN");
      await service.devices.add("/dev/net/tun:/dev/net/tun");
      await service.restart.set("unless-stopped");
    },
  );

  const qbittorrent = new QBittorrentResource(
    "qbittorrent",
    exposeHttp(
      withLinuxServerDefaults(
        builder
          .addContainer(
            "qbittorrent",
            "ghcr.io/linuxserver/qbittorrent:latest",
          )
          .withEnvironment("WEBUI_PORT", "8080")
          .withBindMount(join(paths.data, "qbittorrent"), "/config")
          .withBindMount(paths.downloads, "/downloads")
          .withBindMount(join(paths.media, "movies"), "/movies")
          .withBindMount(join(paths.media, "tv"), "/tv")
          .withBindMount(join(paths.media, "music"), "/music")
          .waitFor(gluetun.resource),
        parameters,
        paths.rootlessPodman,
      ),
      8080,
      "/",
    ),
  );

  const sonarr = new SonarrResource(
    "sonarr",
    exposeHttp(
      withLinuxServerDefaults(
        builder
          .addContainer("sonarr", "ghcr.io/linuxserver/sonarr:latest")
          .withBindMount(join(paths.data, "sonarr"), "/config")
          .withBindMount(join(paths.media, "tv"), "/tv")
          .withBindMount(paths.downloads, "/downloads"),
        parameters,
        paths.rootlessPodman,
      ),
      8989,
      "/ping",
    ),
  );

  const radarr = new RadarrResource(
    "radarr",
    exposeHttp(
      withLinuxServerDefaults(
        builder
          .addContainer("radarr", "ghcr.io/linuxserver/radarr:latest")
          .withBindMount(join(paths.data, "radarr"), "/config")
          .withBindMount(join(paths.media, "movies"), "/movies")
          .withBindMount(paths.downloads, "/downloads"),
        parameters,
        paths.rootlessPodman,
      ),
      7878,
      "/ping",
    ),
  );

  const lidarr = new LidarrResource(
    "lidarr",
    exposeHttp(
      withLinuxServerDefaults(
        builder
          .addContainer("lidarr", "ghcr.io/linuxserver/lidarr:latest")
          .withBindMount(join(paths.data, "lidarr"), "/config")
          .withBindMount(join(paths.media, "music"), "/music")
          .withBindMount(paths.downloads, "/downloads"),
        parameters,
        paths.rootlessPodman,
      ),
      8686,
      "/ping",
    ),
  );

  const prowlarr = new ProwlarrResource(
    "prowlarr",
    exposeHttp(
      withLinuxServerDefaults(
        builder
          .addContainer(
            "prowlarr",
            "lscr.io/linuxserver/prowlarr:latest",
          )
          .withBindMount(join(paths.data, "prowlarr"), "/config")
          .waitFor(gluetun.resource),
        parameters,
        paths.rootlessPodman,
      ),
      9696,
      "/ping",
    ),
  );

  const bazarr = new BazarrResource(
    "bazarr",
    exposeHttp(
      withLinuxServerDefaults(
        builder
          .addContainer("bazarr", "ghcr.io/linuxserver/bazarr:latest")
          .withBindMount(join(paths.data, "bazarr"), "/config")
          .withBindMount(join(paths.media, "movies"), "/movies")
          .withBindMount(join(paths.media, "tv"), "/tv"),
        parameters,
        paths.rootlessPodman,
      ),
      6767,
      "/",
    ),
  );

  const jellyfin = new JellyfinResource(
    "jellyfin",
    exposeHttp(
      builder
        .addContainer("jellyfin", "docker.io/jellyfin/jellyfin:10.11.11")
        .withEnvironment("TZ", parameters.timezone)
        .withBindMount(join(paths.data, "jellyfin"), "/config")
        .withBindMount(join(paths.data, "jellyfin-cache"), "/cache")
        .withBindMount(paths.media, "/media"),
      8096,
      "/health",
    ),
  );

  const jellyseerr = new JellyseerrResource(
    "jellyseerr",
    exposeHttp(
      withLinuxServerDefaults(
        builder
          .addContainer(
            "jellyseerr",
            "ghcr.io/fallenbagel/jellyseerr:latest",
          )
          .withBindMount(join(paths.data, "jellyseerr"), "/app/config"),
        parameters,
        paths.rootlessPodman,
      ),
      5055,
      "/api/v1/status",
    ),
  );

  const recyclarr = new RecyclarrResource(
    "recyclarr",
    builder
      .addContainer(
        "recyclarr",
        "ghcr.io/recyclarr/recyclarr:latest",
      )
      .withEnvironment("TZ", parameters.timezone)
      .withEnvironment("CRON_SCHEDULE", "@daily")
      .withBindMount(join(paths.data, "recyclarr"), "/config"),
  );

  const duplicati = new DuplicatiResource(
    "duplicati",
    exposeHttp(
      builder
        .addContainer("duplicati", "docker.io/duplicati/duplicati:latest")
        .withEnvironment("TZ", parameters.timezone)
        .withEnvironment(
          "DUPLICATI__SETTINGS_ENCRYPTION_KEY",
          parameters.duplicatiEncryptionKey,
        )
        .withEnvironment(
          "DUPLICATI__WEBSERVICE_PASSWORD",
          parameters.duplicatiWebPassword,
        )
        .withBindMount(join(paths.data, "duplicati"), "/data")
        .withBindMount(join(paths.data, "backups"), "/backups")
        .withBindMount(join(paths.data, "sonarr"), "/source/sonarr", {
          isReadOnly: true,
        })
        .withBindMount(join(paths.data, "radarr"), "/source/radarr", {
          isReadOnly: true,
        })
        .withBindMount(join(paths.data, "lidarr"), "/source/lidarr", {
          isReadOnly: true,
        })
        .withBindMount(join(paths.data, "prowlarr"), "/source/prowlarr", {
          isReadOnly: true,
        })
        .withBindMount(join(paths.data, "bazarr"), "/source/bazarr", {
          isReadOnly: true,
        })
        .withBindMount(join(paths.data, "jellyfin"), "/source/jellyfin", {
          isReadOnly: true,
        })
        .withBindMount(
          join(paths.data, "jellyseerr"),
          "/source/jellyseerr",
          { isReadOnly: true },
        )
        .withBindMount(
          join(paths.data, "qbittorrent"),
          "/source/qbittorrent",
          { isReadOnly: true },
        )
        .withBindMount(join(paths.data, "gluetun"), "/source/gluetun", {
          isReadOnly: true,
        }),
      8200,
      "/",
    ),
  );

  const tdarr = new TdarrResource(
    "tdarr",
    builder
      .addContainer("tdarr", "ghcr.io/haveagitgat/tdarr:latest")
      .withEnvironment("TZ", parameters.timezone)
      .withEnvironment("PUID", process.getuid?.().toString() ?? "1000")
      .withEnvironment("PGID", process.getgid?.().toString() ?? "1000")
      .withEnvironment("UMASK_SET", "002")
      .withEnvironment("serverIP", "0.0.0.0")
      .withEnvironment("serverPort", "8266")
      .withEnvironment("webUIPort", "8265")
      .withEnvironment("internalNode", "true")
      .withEnvironment("inContainer", "true")
      .withEnvironment("ffmpegVersion", "7")
      .withEnvironment("nodeName", "InternalNode")
      .withBindMount(join(paths.data, "tdarr", "server"), "/app/server")
      .withBindMount(join(paths.data, "tdarr", "configs"), "/app/configs")
      .withBindMount(join(paths.data, "tdarr", "logs"), "/app/logs")
      .withBindMount(
        join(paths.data, "tdarr", "transcode-cache"),
        "/temp",
      )
      .withBindMount(paths.media, "/media")
      .withHttpEndpoint({
        name: "webui",
        port: 8265,
        targetPort: 8265,
      })
      .withHttpEndpoint({
        name: "server",
        port: 8266,
        targetPort: 8266,
      })
      .withHttpHealthCheck({
        endpointName: "webui",
        path: "/api/v2/status",
      })
      .withExternalHttpEndpoints(),
  );

  const traefik = new TraefikResource(
    "traefik",
    builder
      .addContainer("traefik", "docker.io/library/traefik:v3.5")
      .withArgs([
        "--api.dashboard=true",
        "--api.insecure=true",
        "--ping=true",
        "--entrypoints.web.address=:80",
        "--entrypoints.websecure.address=:443",
        "--providers.file.directory=/etc/traefik/dynamic",
        "--providers.file.watch=true",
        "--accesslog=true",
        "--accesslog.filepath=/var/log/traefik/access.log",
        "--accesslog.format=common",
      ])
      .withBindMount(join(paths.data, "traefik", "dynamic"), "/etc/traefik/dynamic", {
        isReadOnly: true,
      })
      .withBindMount(join(paths.data, "traefik", "acme"), "/acme")
      .withBindMount(join(paths.data, "traefik", "logs"), "/var/log/traefik")
      .withHttpEndpoint({ name: "http", port: 80, targetPort: 80 })
      .withHttpEndpoint({ name: "https", port: 443, targetPort: 443 })
      .withHttpEndpoint({
        name: "dashboard",
        port: 8081,
        targetPort: 8080,
      })
      .withHttpHealthCheck({ endpointName: "dashboard", path: "/ping" })
      .withExternalHttpEndpoints(),
  );

  const fail2ban = new Fail2banResource(
    "fail2ban",
    builder
      .addContainer("fail2ban", "docker.io/crazymax/fail2ban:latest")
      .withEnvironment("TZ", parameters.timezone)
      .withEnvironment("F2B_LOG_TARGET", "STDOUT")
      .withEnvironment("F2B_LOG_LEVEL", "INFO")
      .withEnvironment("F2B_DB_PURGE_AGE", "7d")
      .withBindMount(join(paths.data, "fail2ban"), "/data")
      .withBindMount(
        join(paths.data, "traefik", "logs"),
        "/var/log/traefik",
        { isReadOnly: true },
      )
      .waitFor(traefik.resource),
  );

  await fail2ban.resource.publishAsDockerComposeService(
    async (_compose, service) => {
      await service.capAdd.add("NET_ADMIN");
      await service.capAdd.add("NET_RAW");
      await service.networkMode.set("host");
      await service.networks.clear();
      await service.restart.set("unless-stopped");
    },
  );

  const diun = new DiunResource(
    "diun",
    builder
      .addContainer("diun", "docker.io/crazymax/diun:latest")
      .withEnvironment("TZ", parameters.timezone)
      .withEnvironment("LOG_LEVEL", "info")
      .withEnvironment("LOG_JSON", "false")
      .withEnvironment("DIUN_WATCH_WORKERS", "20")
      .withEnvironment("DIUN_WATCH_SCHEDULE", "0 */6 * * *")
      .withEnvironment("DIUN_PROVIDERS_DOCKER", "true")
      .withEnvironment("DIUN_PROVIDERS_DOCKER_WATCHBYDEFAULT", "true")
      .withBindMount(join(paths.data, "diun"), "/data")
      .withBindMount(paths.containerSocket, "/var/run/docker.sock", {
        isReadOnly: true,
      }),
  );

  const prometheus = new PrometheusResource(
    "prometheus",
    exposeHttp(
      builder
        .addContainer("prometheus", "docker.io/prom/prometheus:latest")
        .withVolume("/prometheus", { name: "prometheus-data" })
        .withBindMount(
          join(paths.data, "prometheus-config"),
          "/etc/prometheus",
          { isReadOnly: true },
        ),
      9090,
      "/-/healthy",
    ),
  );

  const grafana = new GrafanaResource(
    "grafana",
    exposeHttp(
      builder
        .addContainer("grafana", "docker.io/grafana/grafana:latest")
        .withEnvironment(
          "GF_SECURITY_ADMIN_PASSWORD",
          parameters.grafanaAdminPassword,
        )
        .withEnvironment("GF_USERS_ALLOW_SIGN_UP", "false")
        .withVolume("/var/lib/grafana", { name: "grafana-data" })
        .withBindMount(
          join(paths.data, "grafana-provisioning"),
          "/etc/grafana/provisioning",
          { isReadOnly: true },
        )
        .waitFor(prometheus.resource),
      3000,
      "/api/health",
    ),
  );

  const qbitEndpoint = isRunMode
    ? qbittorrent.endpoint("http")
    : gluetun.endpoint("qbittorrent");
  const prowlarrEndpoint = isRunMode
    ? prowlarr.endpoint("http")
    : gluetun.endpoint("prowlarr");

  const bootstrap = addBootstrap(
    builder,
    parameters,
    paths,
    {
      sonarr: sonarr.endpoint("http"),
      radarr: radarr.endpoint("http"),
      lidarr: lidarr.endpoint("http"),
      prowlarr: prowlarrEndpoint,
      bazarr: bazarr.endpoint("http"),
      jellyfin: jellyfin.endpoint("http"),
      jellyseerr: jellyseerr.endpoint("http"),
      qbittorrent: qbitEndpoint,
      prometheus: prometheus.endpoint("http"),
      grafana: grafana.endpoint("http"),
    },
  );

  const bootstrappedResources = [
    gluetun.resource,
    qbittorrent.resource,
    sonarr.resource,
    radarr.resource,
    lidarr.resource,
    prowlarr.resource,
    bazarr.resource,
    jellyfin.resource,
    jellyseerr.resource,
    recyclarr.resource,
    duplicati.resource,
    tdarr.resource,
    traefik.resource,
    fail2ban.resource,
    diun.resource,
    prometheus.resource,
    grafana.resource,
  ];
  await Promise.all(
    bootstrappedResources.map((resource) =>
      resource.waitForCompletion(bootstrap.resource),
    ),
  );

  if (!isRunMode) {
    await shareComposeNetworkNamespace(qbittorrent.resource, gluetun.name);
    await shareComposeNetworkNamespace(prowlarr.resource, gluetun.name);
  }

  const reconciler = addReconciler(
    builder,
    parameters,
    paths,
    {
      gluetunProxy: gluetun.endpoint("http-proxy"),
      sonarr: sonarr.endpoint("http"),
      radarr: radarr.endpoint("http"),
      lidarr: lidarr.endpoint("http"),
      prowlarr: prowlarrEndpoint,
      bazarr: bazarr.endpoint("http"),
      jellyfin: jellyfin.endpoint("http"),
      jellyseerr: jellyseerr.endpoint("http"),
      qbittorrent: qbitEndpoint,
    },
    [
      gluetun.resource,
      qbittorrent.resource,
      sonarr.resource,
      radarr.resource,
      lidarr.resource,
      prowlarr.resource,
      bazarr.resource,
      jellyfin.resource,
      jellyseerr.resource,
    ],
  );

  await recyclarr.resource.waitForCompletion(reconciler.resource);

  const acceptance =
    process.env.ARRSPIRE_E2E === "true"
      ? addAcceptance(
          builder,
          parameters,
          paths,
          {
            gluetunProxy: gluetun.endpoint("http-proxy"),
            sonarr: sonarr.endpoint("http"),
            radarr: radarr.endpoint("http"),
            lidarr: lidarr.endpoint("http"),
            prowlarr: prowlarrEndpoint,
            bazarr: bazarr.endpoint("http"),
            jellyfin: jellyfin.endpoint("http"),
            jellyseerr: jellyseerr.endpoint("http"),
            qbittorrent: qbitEndpoint,
          },
          reconciler,
          bootstrappedResources,
        )
      : undefined;

  await Promise.all(
    [
      gluetun.resource,
      qbittorrent.resource,
      sonarr.resource,
      radarr.resource,
      lidarr.resource,
      prowlarr.resource,
      bazarr.resource,
      jellyfin.resource,
      jellyseerr.resource,
      recyclarr.resource,
      duplicati.resource,
      tdarr.resource,
      traefik.resource,
      diun.resource,
      prometheus.resource,
      grafana.resource,
    ].map(withComposeRestart),
  );

  return {
    gluetun,
    qbittorrent,
    sonarr,
    radarr,
    lidarr,
    prowlarr,
    bazarr,
    jellyfin,
    jellyseerr,
    recyclarr,
    duplicati,
    tdarr,
    traefik,
    fail2ban,
    diun,
    prometheus,
    grafana,
    bootstrap,
    reconciler,
    ...(acceptance === undefined ? {} : { acceptance }),
  };
}

type RoutedServices = Readonly<
  Record<
    | "sonarr"
    | "radarr"
    | "lidarr"
    | "prowlarr"
    | "bazarr"
    | "jellyfin"
    | "jellyseerr"
    | "qbittorrent"
    | "prometheus"
    | "grafana",
    EndpointReferencePromise
  >
>;

function addControlPlaneContainer(
  builder: DistributedApplicationBuilder,
  name: string,
  command: "bootstrap" | "reconcile" | "verify",
  paths: ArrspirePaths,
): ContainerResourcePromise {
  return builder
    .addDockerfile(name, ".", {
      dockerfilePath: "control-plane/Dockerfile",
    })
    .publishAsDockerComposeService(async (_compose, service) => {
      await service.image.set("localhost/arrspire-control-plane:1.0.0");
    })
    .withArgs([command])
    .withBindMount(paths.data, "/data")
    .withBindMount(paths.media, "/media")
    .withBindMount(paths.downloads, "/downloads");
}

function withEndpointEnvironment(
  resource: ContainerResourcePromise,
  endpoints: Readonly<Record<string, EndpointReferencePromise>>,
): ContainerResourcePromise {
  let configured = resource;
  for (const [name, endpoint] of Object.entries(endpoints)) {
    const environmentName = name
      .replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2")
      .replaceAll("-", "_")
      .toUpperCase();
    configured = configured.withEnvironment(
      `${environmentName}_URL`,
      endpoint,
    );
  }
  return configured;
}

function addBootstrap(
  builder: DistributedApplicationBuilder,
  parameters: ArrspireParameters,
  paths: ArrspirePaths,
  endpoints: RoutedServices,
): BootstrapResource {
  const resource = withEndpointEnvironment(
    addControlPlaneContainer(builder, "bootstrap", "bootstrap", paths)
      .withEnvironment(
        "QBITTORRENT_PASSWORD",
        parameters.qbittorrentPassword,
      )
      .withEnvironment("TRAEFIK_DOMAIN", parameters.traefikDomain)
      .withEnvironment("PUID", process.getuid?.().toString() ?? "1000")
      .withEnvironment("PGID", process.getgid?.().toString() ?? "1000"),
    endpoints,
  ).withHiddenOnCompletion();

  return new BootstrapResource("bootstrap", resource);
}

function addReconciler(
  builder: DistributedApplicationBuilder,
  parameters: ArrspireParameters,
  paths: ArrspirePaths,
  endpoints: Readonly<Record<string, EndpointReferencePromise>>,
  dependencies: readonly ContainerResourcePromise[],
): ReconcilerResource {
  let resource = withEndpointEnvironment(
    addControlPlaneContainer(builder, "reconciler", "reconcile", paths)
      .withEnvironment(
        "JELLYFIN_ADMIN_USER",
        parameters.jellyfinAdminUser,
      )
      .withEnvironment(
        "JELLYFIN_ADMIN_PASSWORD",
        parameters.jellyfinAdminPassword,
      )
      .withEnvironment(
        "JELLYFIN_SERVER_NAME",
        parameters.jellyfinServerName,
      )
      .withEnvironment("JELLYFIN_LANGUAGE", parameters.jellyfinLanguage)
      .withEnvironment(
        "QBITTORRENT_PASSWORD",
        parameters.qbittorrentPassword,
      )
      .withEnvironment(
        "SUBTITLE_LANGUAGES",
        parameters.subtitleLanguages,
      )
      .withEnvironment("USE_ORIGINAL_TITLE", parameters.useOriginalTitle)
      .withEnvironment("MINIMUM_SEEDERS", parameters.minimumSeeders)
      .withEnvironment(
        "OPENSUBTITLESCOM_USER",
        parameters.opensubtitlesComUser,
      )
      .withEnvironment(
        "OPENSUBTITLESCOM_PASSWORD",
        parameters.opensubtitlesComPassword,
      )
      .withEnvironment(
        "OPENSUBTITLESORG_USER",
        parameters.opensubtitlesOrgUser,
      )
      .withEnvironment(
        "OPENSUBTITLESORG_PASSWORD",
        parameters.opensubtitlesOrgPassword,
      )
      .withEnvironment("LEGENDASDIVX_USER", parameters.legendasDivxUser)
      .withEnvironment(
        "LEGENDASDIVX_PASSWORD",
        parameters.legendasDivxPassword,
      )
      .withEnvironment("LEGENDASNET_USER", parameters.legendasNetUser)
      .withEnvironment(
        "LEGENDASNET_PASSWORD",
        parameters.legendasNetPassword,
      ),
    endpoints,
  );

  for (const dependency of dependencies) {
    resource = resource.waitFor(dependency);
  }

  return new ReconcilerResource(
    "reconciler",
    resource.withHiddenOnCompletion().withLifetime(ContainerLifetime.Session),
  );
}

function addAcceptance(
  builder: DistributedApplicationBuilder,
  parameters: ArrspireParameters,
  paths: ArrspirePaths,
  endpoints: Readonly<Record<string, EndpointReferencePromise>>,
  reconciler: ReconcilerResource,
  dependencies: readonly ContainerResourcePromise[],
): AcceptanceResource {
  let resource = withEndpointEnvironment(
    addControlPlaneContainer(builder, "acceptance", "verify", paths)
      .withEnvironment(
        "JELLYFIN_ADMIN_USER",
        parameters.jellyfinAdminUser,
      )
      .withEnvironment(
        "JELLYFIN_ADMIN_PASSWORD",
        parameters.jellyfinAdminPassword,
      )
      .withEnvironment(
        "QBITTORRENT_PASSWORD",
        parameters.qbittorrentPassword,
      ),
    endpoints,
  )
    .waitForCompletion(reconciler.resource)
    .withLifetime(ContainerLifetime.Session);
  for (const dependency of dependencies) {
    resource = resource.waitFor(dependency);
  }

  return new AcceptanceResource("acceptance", resource);
}
