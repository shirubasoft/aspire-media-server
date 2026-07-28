import { randomUUID } from "node:crypto";
import { join } from "node:path";

import type {
  ContainerResourcePromise,
  EndpointReferencePromise,
} from "../../.aspire/modules/aspire.mjs";
import {
  ArrspireResource,
  type ResourceContext,
} from "./resource.mjs";

export class GluetunResource extends ArrspireResource<"gluetun"> {
  private constructor(
    resource: ContainerResourcePromise,
    readonly runContainerName?: string,
  ) {
    super("gluetun", resource);
  }

  get control(): EndpointReferencePromise {
    return this.endpoint("control");
  }

  get httpProxy(): EndpointReferencePromise {
    return this.endpoint("http-proxy");
  }

  get qbittorrent(): EndpointReferencePromise {
    return this.endpoint("qbittorrent");
  }

  get prowlarr(): EndpointReferencePromise {
    return this.endpoint("prowlarr");
  }

  get runInstanceId(): string | undefined {
    return this.runContainerName?.slice(
      "arrspire-".length,
      -"-gluetun".length,
    );
  }

  static async add(context: ResourceContext): Promise<GluetunResource> {
    const runContainerName = context.isRunMode
      ? createRunContainerName()
      : undefined;
    let resource = context.builder
      .addContainer("gluetun", "docker.io/qmcgaw/gluetun:latest")
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
        port: 8080,
        targetPort: 8080,
        isExternal: true,
      })
      .withEndpoint({
        name: "prowlarr",
        scheme: "http",
        port: 9696,
        targetPort: 9696,
        isExternal: true,
      });

    if (runContainerName !== undefined) {
      resource = resource.withContainerName(runContainerName);
    }

    await resource.publishAsDockerComposeService(
      async (_compose, service) => {
        await service.capAdd.add("NET_ADMIN");
        await service.devices.add("/dev/net/tun:/dev/net/tun");
        await service.restart.set("unless-stopped");
      },
    );

    return new GluetunResource(resource, runContainerName);
  }
}

function createRunContainerName(): string {
  const instanceId = (
    process.env.ARRSPIRE_INSTANCE_ID ?? randomUUID().slice(0, 8)
  ).replaceAll(/[^a-zA-Z0-9_.-]/gu, "-");

  return `arrspire-${instanceId}-gluetun`;
}
