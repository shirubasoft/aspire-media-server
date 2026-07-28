import { join } from "node:path";

import type { GluetunResource } from "./gluetun.mjs";
import { images } from "../images.mjs";
import {
  type ResourceContext,
  exposeHttp,
  withLinuxServerDefaults,
} from "./resource.mjs";
import {
  addVpnProcess,
  configureComposeVpnNetwork,
  createVpnRoutedResource,
  type VpnRoutedResource,
} from "./vpn-routed.mjs";

const image = images.prowlarr;

export type ProwlarrResource = VpnRoutedResource<"prowlarr"> &
  Readonly<{
    apiVersion: "v1";
    configDirectory: "/data/prowlarr";
  }>;

export async function addProwlarr(
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

  const resource = context.isRunMode
    ? addVpnProcess(context, gluetun, {
        name: "prowlarr",
        image,
        mounts: [[join(context.paths.data, "prowlarr"), "/config"]],
      })
    : composeResource;

  if (!context.isRunMode) {
    await configureComposeVpnNetwork(composeResource, gluetun);
  }

  return {
    ...createVpnRoutedResource(
      "prowlarr",
      resource,
      composeResource,
      gluetun.prowlarr,
    ),
    apiVersion: "v1",
    configDirectory: "/data/prowlarr",
  };
}
