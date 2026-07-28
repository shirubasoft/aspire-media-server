import { join } from "node:path";

import type {
  ContainerResourcePromise,
  ExecutableResourcePromise,
} from "../../.aspire/modules/aspire.mjs";
import { GluetunResource } from "./gluetun.mjs";
import {
  type ResourceContext,
  exposeHttp,
  ArrApiResource,
  withLinuxServerDefaults,
} from "./resource.mjs";
import {
  addVpnProcess,
  configureComposeVpnNetwork,
} from "./vpn-routed.mjs";

const image = "lscr.io/linuxserver/prowlarr:latest";

export class ProwlarrResource extends ArrApiResource<
  "prowlarr",
  ContainerResourcePromise | ExecutableResourcePromise
> {
  readonly apiVersion = "v1" as const;
  readonly configDirectory = "/data/prowlarr";

  private constructor(
    resource: ContainerResourcePromise | ExecutableResourcePromise,
    readonly composeResource: ContainerResourcePromise,
    gluetun: GluetunResource,
  ) {
    super("prowlarr", resource, gluetun.prowlarr);
  }

  static async add(
    context: ResourceContext,
    gluetun: GluetunResource,
  ): Promise<ProwlarrResource> {
    let composeResource = exposeHttp(
      withLinuxServerDefaults(
        context.builder
          .addContainer("prowlarr", image)
          .withBindMount(join(context.paths.data, "prowlarr"), "/config")
          .waitFor(gluetun.resource),
        context,
      ),
      9696,
      "/ping",
    );

    if (context.isRunMode) {
      composeResource = composeResource.withExplicitStart();
    }

    let resource: ContainerResourcePromise | ExecutableResourcePromise;
    if (context.isRunMode) {
      resource = addVpnProcess(context, gluetun, {
        name: "prowlarr",
        image,
        mounts: [[join(context.paths.data, "prowlarr"), "/config"]],
      });
    } else {
      await configureComposeVpnNetwork(composeResource, gluetun);
      resource = composeResource;
    }

    return new ProwlarrResource(resource, composeResource, gluetun);
  }
}
