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
import {
  type ArrspireResourcePromise,
  ArrspireResource,
  type ResourceContext,
} from "./resource.mjs";

export class ReconcilerResource extends ArrspireResource<"reconciler"> {
  private constructor(resource: ContainerResourcePromise) {
    super("reconciler", resource);
  }

  static add(
    context: ResourceContext,
    endpoints: ControlPlaneEndpoints,
    dependencies: readonly ArrspireResourcePromise[],
  ): ReconcilerResource {
    const resource = waitForResources(
      withEndpointEnvironment(
        addControlPlaneContainer(context, "reconciler", "reconcile")
          .withEnvironment(
            "JELLYFIN_ADMIN_USER",
            context.parameters.jellyfinAdminUser,
          )
          .withEnvironment(
            "JELLYFIN_ADMIN_PASSWORD",
            context.parameters.jellyfinAdminPassword,
          )
          .withEnvironment(
            "JELLYFIN_SERVER_NAME",
            context.parameters.jellyfinServerName,
          )
          .withEnvironment(
            "JELLYFIN_LANGUAGE",
            context.parameters.jellyfinLanguage,
          )
          .withEnvironment(
            "QBITTORRENT_PASSWORD",
            context.parameters.qbittorrentPassword,
          )
          .withEnvironment(
            "SUBTITLE_LANGUAGES",
            context.parameters.subtitleLanguages,
          )
          .withEnvironment(
            "USE_ORIGINAL_TITLE",
            context.parameters.useOriginalTitle,
          )
          .withEnvironment(
            "MINIMUM_SEEDERS",
            context.parameters.minimumSeeders,
          )
          .withEnvironment(
            "OPENSUBTITLESCOM_USER",
            context.parameters.opensubtitlesComUser,
          )
          .withEnvironment(
            "OPENSUBTITLESCOM_PASSWORD",
            context.parameters.opensubtitlesComPassword,
          )
          .withEnvironment(
            "OPENSUBTITLESORG_USER",
            context.parameters.opensubtitlesOrgUser,
          )
          .withEnvironment(
            "OPENSUBTITLESORG_PASSWORD",
            context.parameters.opensubtitlesOrgPassword,
          )
          .withEnvironment(
            "LEGENDASDIVX_USER",
            context.parameters.legendasDivxUser,
          )
          .withEnvironment(
            "LEGENDASDIVX_PASSWORD",
            context.parameters.legendasDivxPassword,
          )
          .withEnvironment(
            "LEGENDASNET_USER",
            context.parameters.legendasNetUser,
          )
          .withEnvironment(
            "LEGENDASNET_PASSWORD",
            context.parameters.legendasNetPassword,
          ),
        endpoints,
      ),
      dependencies,
    )
      .withHiddenOnCompletion()
      .withLifetime(ContainerLifetime.Session);

    return new ReconcilerResource(resource);
  }
}
