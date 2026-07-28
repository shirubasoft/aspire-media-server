import { join } from "node:path";

import type {
  ContainerResourcePromise,
  ExecutableResourcePromise,
} from "../../.aspire/modules/aspire.mjs";
import { GluetunResource } from "./gluetun.mjs";
import {
  exposeHttp,
  type ResourceContext,
  withLinuxServerDefaults,
} from "./resource.mjs";
import {
  addVpnProcess,
  configureComposeVpnNetwork,
  VpnRoutedResource,
} from "./vpn-routed.mjs";

const image = "ghcr.io/linuxserver/qbittorrent:latest";

export class QBittorrentResource extends VpnRoutedResource<"qbittorrent"> {
  private constructor(
    resource: ContainerResourcePromise | ExecutableResourcePromise,
    composeResource: ContainerResourcePromise,
    gluetun: GluetunResource,
  ) {
    super(
      "qbittorrent",
      resource,
      composeResource,
      gluetun.qbittorrent,
    );
  }

  static async add(
    context: ResourceContext,
    gluetun: GluetunResource,
  ): Promise<QBittorrentResource> {
    let composeResource = exposeHttp(
      withLinuxServerDefaults(
        context.builder
          .addContainer("qbittorrent", image)
          .withEnvironment("WEBUI_PORT", "8080")
          .withBindMount(
            join(context.paths.data, "qbittorrent"),
            "/config",
          )
          .withBindMount(context.paths.downloads, "/downloads")
          .withBindMount(join(context.paths.media, "movies"), "/movies")
          .withBindMount(join(context.paths.media, "tv"), "/tv")
          .withBindMount(join(context.paths.media, "music"), "/music")
          .waitFor(gluetun.resource),
        context,
      ),
      8080,
      "/",
    );

    if (context.isRunMode) {
      composeResource = composeResource.withExplicitStart();
    }

    let resource: ContainerResourcePromise | ExecutableResourcePromise;
    if (context.isRunMode) {
      resource = addVpnProcess(context, gluetun, {
        name: "qbittorrent",
        image,
        environment: { WEBUI_PORT: "8080" },
        mounts: [
          [join(context.paths.data, "qbittorrent"), "/config"],
          [context.paths.downloads, "/downloads"],
          [join(context.paths.media, "movies"), "/movies"],
          [join(context.paths.media, "tv"), "/tv"],
          [join(context.paths.media, "music"), "/music"],
        ],
      });
    } else {
      await configureComposeVpnNetwork(composeResource, gluetun);
      resource = composeResource;
    }

    return new QBittorrentResource(resource, composeResource, gluetun);
  }
}
