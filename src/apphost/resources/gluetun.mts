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

const qbittorrentPortForwardingUpCommand =
  "/bin/sh -c 'wget -O- -nv --tries=60 --waitretry=1 " +
  "--retry-connrefused " +
  '--post-data "json={\\"listen_port\\":{{PORT}},' +
  '\\"current_network_interface\\":\\"{{VPN_INTERFACE}}\\",' +
  '\\"random_port\\":false,\\"upnp\\":false}" ' +
  "http://127.0.0.1:8080/api/v2/app/setPreferences'";
const qbittorrentPortForwardingDownCommand =
  "/bin/sh -c 'wget -O- -nv --tries=60 --waitretry=1 " +
  "--retry-connrefused " +
  '--post-data "json={\\"listen_port\\":0,' +
  '\\"current_network_interface\\":\\"lo\\"}" ' +
  "http://127.0.0.1:8080/api/v2/app/setPreferences'";

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
    .withEnvironment("VPN_PORT_FORWARDING", "on")
    .withEnvironment("VPN_PORT_FORWARDING_PROVIDER", "protonvpn")
    .withEnvironment(
      "VPN_PORT_FORWARDING_UP_COMMAND",
      qbittorrentPortForwardingUpCommand,
    )
    .withEnvironment(
      "VPN_PORT_FORWARDING_DOWN_COMMAND",
      qbittorrentPortForwardingDownCommand,
    )
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
