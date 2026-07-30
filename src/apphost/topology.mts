import type { DistributedApplicationBuilder } from "../.aspire/modules/aspire.mjs";
import type { ArrspireParameters } from "./parameters.mjs";
import type { ArrspirePaths } from "./paths.mjs";
import {
  addAcceptance,
  addAuthelia,
  addBazarr,
  addBootstrap,
  addDiun,
  addDuplicati,
  addFail2ban,
  addGluetun,
  addGrafana,
  addHomepage,
  addNotifier,
  addJellyfin,
  addLidarr,
  addPrometheus,
  addProwlarr,
  addQBittorrent,
  addRadarr,
  addReconciler,
  addRecyclarr,
  addSeerr,
  addSonarr,
  addTdarr,
  addTraefik,
  type AcceptanceResource,
  type AutheliaResource,
  type BazarrResource,
  type BootstrapResource,
  type DiunResource,
  type DuplicatiResource,
  type Fail2banResource,
  type GluetunResource,
  type GrafanaResource,
  type HomepageResource,
  type NotifierResource,
  type JellyfinResource,
  type LidarrResource,
  type PrometheusResource,
  type ProwlarrResource,
  type QBittorrentResource,
  type RadarrResource,
  type ReconcilerResource,
  type RecyclarrResource,
  type ResourceContext,
  type SeerrResource,
  type SonarrResource,
  type TdarrResource,
  type TraefikResource,
  withComposeInit,
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
  seerr: SeerrResource;
  recyclarr: RecyclarrResource;
  duplicati: DuplicatiResource;
  tdarr: TdarrResource;
  authelia: AutheliaResource;
  traefik: TraefikResource;
  fail2ban: Fail2banResource;
  diun: DiunResource;
  prometheus: PrometheusResource;
  grafana: GrafanaResource;
  homepage: HomepageResource;
  notifier: NotifierResource;
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
  const seerr = addSeerr(context);
  const recyclarr = addRecyclarr(context);
  const duplicati = addDuplicati(context);
  const tdarr = addTdarr(context);
  const authelia = addAuthelia(context);
  const traefik = addTraefik(context, authelia);
  const fail2ban = await addFail2ban(context, traefik);
  const prometheus = addPrometheus(context);
  const grafana = addGrafana(context, prometheus);
  const homepage = await addHomepage(context);
  const notifier = await addNotifier(context, {
    homepage: homepage.http,
  });
  const diun = await addDiun(context, notifier);

  const applicationEndpoints = {
    sonarr: sonarr.http,
    radarr: radarr.http,
    lidarr: lidarr.http,
    prowlarr: prowlarr.http,
    bazarr: bazarr.http,
    jellyfin: jellyfin.http,
    seerr: seerr.http,
    qbittorrent: qbittorrent.http,
    tdarr: tdarr.webUi,
    duplicati: duplicati.http,
    homepage: homepage.http,
    auth: authelia.http,
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
    seerr.resource,
    recyclarr.resource,
    duplicati.resource,
    tdarr.resource,
    authelia.resource,
    traefik.resource,
    fail2ban.resource,
    diun.resource,
    prometheus.resource,
    grafana.resource,
    homepage.resource,
    notifier.resource,
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
    seerr.resource,
    tdarr.resource,
    authelia.resource,
    notifier.resource,
  ];
  const reconciliationEndpoints = {
    gluetunProxy: gluetun.httpProxy,
    ingress: traefik.https,
    notifier: notifier.http,
    ...applicationEndpoints,
  };
  await recyclarr.sync.waitFor(sonarr.resource);
  await recyclarr.sync.waitFor(radarr.resource);
  const reconciler = addReconciler(
    context,
    reconciliationEndpoints,
    reconciledResources,
  );

  await reconciler.resource.waitFor(recyclarr.sync);
  await recyclarr.resource.waitForCompletion(reconciler.resource);

  const acceptance =
    process.env.ARRSPIRE_E2E === "true"
      ? addAcceptance(
          context,
          reconciliationEndpoints,
          reconciler,
          [...reconciledResources, homepage.resource],
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
      seerr.resource,
      recyclarr.resource,
      duplicati.resource,
      tdarr.resource,
      authelia.resource,
      traefik.resource,
      diun.resource,
      prometheus.resource,
      grafana.resource,
      homepage.resource,
      notifier.resource,
    ].map((resource) => withComposeRestart(resource)),
    withComposeInit(seerr.resource),
    withComposeInit(authelia.resource),
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
    seerr,
    recyclarr,
    duplicati,
    tdarr,
    authelia,
    traefik,
    fail2ban,
    diun,
    prometheus,
    grafana,
    homepage,
    notifier,
    bootstrap,
    reconciler,
    ...(acceptance === undefined ? {} : { acceptance }),
  };
}
