import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  addControlPlaneContainer,
  type ControlPlaneEndpoints,
  withEndpointEnvironment,
} from "./control-plane.mjs";
import {
  ArrspireResource,
  type ResourceContext,
} from "./resource.mjs";

export class BootstrapResource extends ArrspireResource<"bootstrap"> {
  private constructor(resource: ContainerResourcePromise) {
    super("bootstrap", resource);
  }

  static add(
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

    return new BootstrapResource(resource);
  }
}
