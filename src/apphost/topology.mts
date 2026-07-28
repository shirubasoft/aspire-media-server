import type { DistributedApplicationBuilder } from "../.aspire/modules/aspire.mjs";
import type { ArrspireParameters } from "./parameters.mjs";
import type { ArrspirePaths } from "./paths.mjs";
import { AcceptanceResource } from "./resources/acceptance.mjs";
import { BazarrResource } from "./resources/bazarr.mjs";
import { BootstrapResource } from "./resources/bootstrap.mjs";
import { DiunResource } from "./resources/diun.mjs";
import { DuplicatiResource } from "./resources/duplicati.mjs";
import { Fail2banResource } from "./resources/fail2ban.mjs";
import { GluetunResource } from "./resources/gluetun.mjs";
import { GrafanaResource } from "./resources/grafana.mjs";
import { JellyfinResource } from "./resources/jellyfin.mjs";
import { JellyseerrResource } from "./resources/jellyseerr.mjs";
import { LidarrResource } from "./resources/lidarr.mjs";
import { PrometheusResource } from "./resources/prometheus.mjs";
import { ProwlarrResource } from "./resources/prowlarr.mjs";
import { QBittorrentResource } from "./resources/qbittorrent.mjs";
import { RadarrResource } from "./resources/radarr.mjs";
import { ReconcilerResource } from "./resources/reconciler.mjs";
import { RecyclarrResource } from "./resources/recyclarr.mjs";
import {
  type ResourceContext,
  withComposeRestart,
} from "./resources/resource.mjs";
import { SonarrResource } from "./resources/sonarr.mjs";
import { TdarrResource } from "./resources/tdarr.mjs";
import { TraefikResource } from "./resources/traefik.mjs";

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

  const gluetun = await GluetunResource.add(context);
  const qbittorrent = await QBittorrentResource.add(context, gluetun);
  const prowlarr = await ProwlarrResource.add(context, gluetun);

  const sonarr = SonarrResource.add(context);
  const radarr = RadarrResource.add(context);
  const lidarr = LidarrResource.add(context);
  const bazarr = BazarrResource.add(context);
  const jellyfin = JellyfinResource.add(context);
  const jellyseerr = JellyseerrResource.add(context);
  const recyclarr = RecyclarrResource.add(context);
  const duplicati = DuplicatiResource.add(context);
  const tdarr = TdarrResource.add(context);
  const traefik = TraefikResource.add(context);
  const fail2ban = await Fail2banResource.add(context, traefik);
  const diun = DiunResource.add(context);
  const prometheus = PrometheusResource.add(context);
  const grafana = GrafanaResource.add(context, prometheus);

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

  const bootstrap = BootstrapResource.add(context, {
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
  const reconciler = ReconcilerResource.add(
    context,
    reconciliationEndpoints,
    reconciledResources,
  );

  await recyclarr.resource.waitForCompletion(reconciler.resource);

  const acceptance =
    process.env.ARRSPIRE_E2E === "true"
      ? AcceptanceResource.add(
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
