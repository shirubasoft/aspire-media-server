import type {
  ContainerResourcePromise,
  EndpointReferencePromise,
} from "../.aspire/modules/aspire.mjs";

/**
 * A small domain wrapper around Aspire's container builder.
 *
 * The literal `kind` makes every resource nominally distinct to TypeScript, so
 * integration functions cannot accidentally accept (for example) Radarr where
 * Sonarr is required while all Aspire capabilities remain available through
 * `resource`.
 */
export abstract class ArrspireContainer<
  TKind extends string,
  TEndpoint extends string,
> {
  protected constructor(
    readonly kind: TKind,
    readonly name: string,
    readonly resource: ContainerResourcePromise,
  ) {}

  endpoint(name: TEndpoint): EndpointReferencePromise {
    return this.resource.getEndpoint(name);
  }
}

export abstract class ArrApiResource<
  TKind extends "sonarr" | "radarr" | "lidarr" | "prowlarr",
> extends ArrspireContainer<TKind, "http"> {
  abstract readonly apiVersion: "v1" | "v3";
  abstract readonly configDirectory: string;
}

export class GluetunResource extends ArrspireContainer<
  "gluetun",
  "control" | "http-proxy" | "qbittorrent" | "prowlarr"
> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("gluetun", name, resource);
  }
}

export class QBittorrentResource extends ArrspireContainer<
  "qbittorrent",
  "http"
> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("qbittorrent", name, resource);
  }
}

export class SonarrResource extends ArrApiResource<"sonarr"> {
  readonly apiVersion = "v3" as const;
  readonly configDirectory = "/data/sonarr";

  constructor(name: string, resource: ContainerResourcePromise) {
    super("sonarr", name, resource);
  }
}

export class RadarrResource extends ArrApiResource<"radarr"> {
  readonly apiVersion = "v3" as const;
  readonly configDirectory = "/data/radarr";

  constructor(name: string, resource: ContainerResourcePromise) {
    super("radarr", name, resource);
  }
}

export class LidarrResource extends ArrApiResource<"lidarr"> {
  readonly apiVersion = "v1" as const;
  readonly configDirectory = "/data/lidarr";

  constructor(name: string, resource: ContainerResourcePromise) {
    super("lidarr", name, resource);
  }
}

export class ProwlarrResource extends ArrApiResource<"prowlarr"> {
  readonly apiVersion = "v1" as const;
  readonly configDirectory = "/data/prowlarr";

  constructor(name: string, resource: ContainerResourcePromise) {
    super("prowlarr", name, resource);
  }
}

export class BazarrResource extends ArrspireContainer<"bazarr", "http"> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("bazarr", name, resource);
  }
}

export class JellyfinResource extends ArrspireContainer<"jellyfin", "http"> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("jellyfin", name, resource);
  }
}

export class JellyseerrResource extends ArrspireContainer<
  "jellyseerr",
  "http"
> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("jellyseerr", name, resource);
  }
}

export class RecyclarrResource extends ArrspireContainer<
  "recyclarr",
  never
> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("recyclarr", name, resource);
  }
}

export class DuplicatiResource extends ArrspireContainer<
  "duplicati",
  "http"
> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("duplicati", name, resource);
  }
}

export class TdarrResource extends ArrspireContainer<
  "tdarr",
  "webui" | "server"
> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("tdarr", name, resource);
  }
}

export class TraefikResource extends ArrspireContainer<
  "traefik",
  "http" | "https" | "dashboard"
> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("traefik", name, resource);
  }
}

export class Fail2banResource extends ArrspireContainer<"fail2ban", never> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("fail2ban", name, resource);
  }
}

export class DiunResource extends ArrspireContainer<"diun", never> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("diun", name, resource);
  }
}

export class PrometheusResource extends ArrspireContainer<
  "prometheus",
  "http"
> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("prometheus", name, resource);
  }
}

export class GrafanaResource extends ArrspireContainer<"grafana", "http"> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("grafana", name, resource);
  }
}

export class BootstrapResource extends ArrspireContainer<"bootstrap", never> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("bootstrap", name, resource);
  }
}

export class ReconcilerResource extends ArrspireContainer<"reconciler", never> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("reconciler", name, resource);
  }
}

export class AcceptanceResource extends ArrspireContainer<"acceptance", never> {
  constructor(name: string, resource: ContainerResourcePromise) {
    super("acceptance", name, resource);
  }
}
