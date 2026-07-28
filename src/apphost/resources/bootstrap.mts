import {
  addControlPlaneContainer,
  type ControlPlaneEndpoints,
  withEndpointEnvironment,
} from "./control-plane.mjs";
import {
  type ArrspireResource,
  createResource,
  type ResourceContext,
} from "./resource.mjs";

export type BootstrapResource = ArrspireResource<"bootstrap">;

export function addBootstrap(
  context: ResourceContext,
  endpoints: ControlPlaneEndpoints,
): BootstrapResource {
  const resource = withEndpointEnvironment(
    addControlPlaneContainer(context, "bootstrap", "bootstrap")
      .withEnvironment(
        "QBITTORRENT_PASSWORD",
        context.parameters.qbittorrentPassword,
      )
      .withEnvironment(
        "TRAEFIK_DOMAIN",
        context.parameters.traefikDomain,
      )
      .withEnvironment(
        "PUID",
        process.getuid?.().toString() ?? "1000",
      )
      .withEnvironment(
        "PGID",
        process.getgid?.().toString() ?? "1000",
      ),
    endpoints,
  ).withHiddenOnCompletion();

  return createResource("bootstrap", resource);
}
