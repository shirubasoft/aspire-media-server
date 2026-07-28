import type { DistributedApplicationBuilder } from "../.aspire/modules/aspire.mjs";
import type { ArrspireParameters } from "./parameters.mjs";
import type { ArrspirePaths } from "./paths.mjs";
import {
  addAcceptance,
  addBazarr,
  addBootstrap,
  addDiun,
  addDuplicati,
  addFail2ban,
  addGluetun,
  addGrafana,
  addJellyfin,
  addJellyseerr,
  addLidarr,
  addPrometheus,
  addProwlarr,
  addQBittorrent,
  addRadarr,
  addReconciler,
  addRecyclarr,
  addSonarr,
  addTdarr,
  addTraefik,
  type AcceptanceResource,
  type BazarrResource,
  type BootstrapResource,
  type DiunResource,
  type DuplicatiResource,
  type Fail2banResource,
  type GluetunResource,
  type GrafanaResource,
  type JellyfinResource,
  type JellyseerrResource,
  type LidarrResource,
  type PrometheusResource,
  type ProwlarrResource,
  type QBittorrentResource,
  type RadarrResource,
  type ReconcilerResource,
  type RecyclarrResource,
  type ResourceContext,
  type SonarrResource,
  type TdarrResource,
  type TraefikResource,
  withComposeRestart,
} from "./resources/index.mjs";

export type ArrspireTopology = Readonly<{
  gluetun: GluetunResource;
  qbittorrent: QBittorrentResource;
  sonarr: SonarrResource;
  radarr: RadarrResource;
  lidarr: LidarrResource;
  prowlarr: ProwlarrResource;
  bazarr: BazarrResource;
  jellyfin: JellyfinResource;
  jellyseerr: JellyseerrResource;
  recyclarr: RecyclarrResource;
  duplicati: DuplicatiResource;
  tdarr: TdarrResource;
  traefik: TraefikResource;
  fail2ban: Fail2banResource;
  diun: DiunResource;
  prometheus: PrometheusResource;
  grafana: GrafanaResource;
  bootstrap: BootstrapResource;
  reconciler: ReconcilerResource;
  acceptance?: AcceptanceResource;
}>;

export async function addArrspireTopology(
  builder: DistributedApplicationBuilder,
  parameters: ArrspireParameters,
  paths: ArrspirePaths,
  isRunMode: boolean,
): Promise<ArrspireTopology> {
  const context: ResourceContext = {
    builder,
    parameters,
    paths,
    isRunMode,
  };

  const gluetun = await addGluetun(context);
  const qbittorrent = await addQBittorrent(context, gluetun);
  const prowlarr = await addProwlarr(context, gluetun);

  const sonarr = addSonarr(context);
  const radarr = addRadarr(context);
  const lidarr = addLidarr(context);
  const bazarr = addBazarr(context);
  const jellyfin = addJellyfin(context);
  const jellyseerr = addJellyseerr(context);
  const recyclarr = addRecyclarr(context);
  const duplicati = addDuplicati(context);
  const tdarr = addTdarr(context);
  const traefik = addTraefik(context);
  const fail2ban = await addFail2ban(context, traefik);
  const diun = addDiun(context);
  const prometheus = addPrometheus(context);
  const grafana = addGrafana(context, prometheus);

  const applicationEndpoints = {
    sonarr: sonarr.http,
    radarr: radarr.http,
    lidarr: lidarr.http,
    prowlarr: prowlarr.http,
    bazarr: bazarr.http,
    jellyfin: jellyfin.http,
    jellyseerr: jellyseerr.http,
    qbittorrent: qbittorrent.http,
  };

  const bootstrap = addBootstrap(context, {
    ...applicationEndpoints,
    prometheus: prometheus.http,
    grafana: grafana.http,
  });

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

  const reconciledResources = [
    gluetun.resource,
    qbittorrent.resource,
    sonarr.resource,
    radarr.resource,
    lidarr.resource,
    prowlarr.resource,
    bazarr.resource,
    jellyfin.resource,
    jellyseerr.resource,
  ];
  const reconciliationEndpoints = {
    gluetunProxy: gluetun.httpProxy,
    ...applicationEndpoints,
  };
  const reconciler = addReconciler(
    context,
    reconciliationEndpoints,
    reconciledResources,
  );

  await recyclarr.resource.waitForCompletion(reconciler.resource);

  const acceptance =
    process.env.ARRSPIRE_E2E === "true"
      ? addAcceptance(
          context,
          reconciliationEndpoints,
          reconciler,
          reconciledResources,
        )
      : undefined;

  await Promise.all([
    ...[
      gluetun.resource,
      qbittorrent.composeResource,
      sonarr.resource,
      radarr.resource,
      lidarr.resource,
      prowlarr.composeResource,
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
    ].map((resource) => withComposeRestart(resource)),
    withComposeRestart(reconciler.resource, "on-failure:5"),
  ]);

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
