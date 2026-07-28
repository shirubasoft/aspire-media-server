import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type {
  ContainerResourcePromise,
  EndpointReferencePromise,
} from "../../.aspire/modules/aspire.mjs";
import type {
  ArrspireResource,
  ResourceContext,
} from "./resource.mjs";
import { directHostAccessEnabled } from "./resource.mjs";
import { images } from "../images.mjs";

export type GluetunResource = ArrspireResource<"gluetun"> &
  Readonly<{
    control: EndpointReferencePromise;
    httpProxy: EndpointReferencePromise;
    qbittorrent: EndpointReferencePromise;
    prowlarr: EndpointReferencePromise;
    runContainerName?: string;
    runInstanceId?: string;
  }>;

export async function addGluetun(
  context: ResourceContext,
): Promise<GluetunResource> {
  const runIdentity = context.isRunMode
    ? createRunIdentity()
    : undefined;
  const directAccess = directHostAccessEnabled();
  let resource = context.builder
    .addContainer("gluetun", images.gluetun)
    .withEnvironment(
      "VPN_SERVICE_PROVIDER",
      context.parameters.vpnProvider,
    )
    .withEnvironment("VPN_TYPE", "wireguard")
    .withEnvironment(
      "WIREGUARD_PRIVATE_KEY",
      context.parameters.vpnWireguardKey,
    )
    .withEnvironment("SERVER_COUNTRIES", context.parameters.vpnCountries)
    .withEnvironment("TZ", context.parameters.timezone)
    .withEnvironment("HTTPPROXY", "on")
    .withEnvironment("HTTPPROXY_STEALTH", "on")
    .withBindMount(join(context.paths.data, "gluetun"), "/gluetun")
    .withContainerRuntimeArgs([
      "--cap-add=NET_ADMIN",
      "--device=/dev/net/tun:/dev/net/tun",
    ])
    .withHttpEndpoint({
      name: "control",
      targetPort: 8000,
    })
    .withHttpEndpoint({
      name: "http-proxy",
      targetPort: 8888,
    })
    .withEndpoint({
      name: "qbittorrent",
      scheme: "http",
      targetPort: 8080,
      isExternal: directAccess,
      ...(directAccess ? { port: 8080 } : {}),
    })
    .withEndpoint({
      name: "prowlarr",
      scheme: "http",
      targetPort: 9696,
      isExternal: directAccess,
      ...(directAccess ? { port: 9696 } : {}),
    });

  if (runIdentity !== undefined) {
    resource = resource.withContainerName(runIdentity.containerName);
  }

  await resource.publishAsDockerComposeService(
    async (_compose, service) => {
      await service.capAdd.add("NET_ADMIN");
      await service.devices.add("/dev/net/tun:/dev/net/tun");
      await service.restart.set("unless-stopped");
    },
  );

  return {
    kind: "gluetun",
    resource,
    control: resource.getEndpoint("control"),
    httpProxy: resource.getEndpoint("http-proxy"),
    qbittorrent: resource.getEndpoint("qbittorrent"),
    prowlarr: resource.getEndpoint("prowlarr"),
    ...(runIdentity === undefined
      ? {}
      : {
          runContainerName: runIdentity.containerName,
          runInstanceId: runIdentity.instanceId,
        }),
  };
}

function createRunIdentity(): Readonly<{
  containerName: string;
  instanceId: string;
}> {
  const instanceId = (
    process.env.ARRSPIRE_INSTANCE_ID ?? randomUUID().slice(0, 8)
  ).replaceAll(/[^a-zA-Z0-9_.-]/gu, "-");

  return {
    instanceId,
    containerName: `arrspire-${instanceId}-gluetun`,
  };
}
