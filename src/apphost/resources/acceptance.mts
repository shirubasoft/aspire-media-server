import {
  ContainerLifetime,
  type ContainerResourcePromise,
} from "../../.aspire/modules/aspire.mjs";
import {
  addControlPlaneContainer,
  type ControlPlaneEndpoints,
  waitForResources,
  withEndpointEnvironment,
} from "./control-plane.mjs";
import { ReconcilerResource } from "./reconciler.mjs";
import {
  type ArrspireResourcePromise,
  ArrspireResource,
  type ResourceContext,
} from "./resource.mjs";

export class AcceptanceResource extends ArrspireResource<"acceptance"> {
  private constructor(resource: ContainerResourcePromise) {
    super("acceptance", resource);
  }

  static add(
    context: ResourceContext,
    endpoints: ControlPlaneEndpoints,
    reconciler: ReconcilerResource,
    dependencies: readonly ArrspireResourcePromise[],
  ): AcceptanceResource {
    const resource = waitForResources(
      withEndpointEnvironment(
        addControlPlaneContainer(context, "acceptance", "verify")
          .withEnvironment(
            "JELLYFIN_ADMIN_USER",
            context.parameters.jellyfinAdminUser,
          )
          .withEnvironment(
            "JELLYFIN_ADMIN_PASSWORD",
            context.parameters.jellyfinAdminPassword,
          )
          .withEnvironment(
            "QBITTORRENT_PASSWORD",
            context.parameters.qbittorrentPassword,
          ),
        endpoints,
      )
        .waitForCompletion(reconciler.resource)
        .withLifetime(ContainerLifetime.Session),
      dependencies,
    );

    return new AcceptanceResource(resource);
  }
}
