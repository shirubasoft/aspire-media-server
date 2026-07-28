import {
  ContainerLifetime,
} from "../../.aspire/modules/aspire.mjs";
import {
  addControlPlaneContainer,
  type ControlPlaneEndpoints,
  waitForResources,
  withEndpointEnvironment,
} from "./control-plane.mjs";
import type { ReconcilerResource } from "./reconciler.mjs";
import {
  type ArrspireResourcePromise,
  type ArrspireResource,
  createResource,
  type ResourceContext,
} from "./resource.mjs";

export type AcceptanceResource = ArrspireResource<"acceptance">;

export function addAcceptance(
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
        )
        .withEnvironment(
          "TRAEFIK_DOMAIN",
          context.parameters.traefikDomain,
        ),
      endpoints,
    )
      .waitForCompletion(reconciler.resource)
      .withLifetime(ContainerLifetime.Session),
    dependencies,
  );

  return createResource("acceptance", resource);
}
