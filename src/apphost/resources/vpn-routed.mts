import type {
  ContainerResourcePromise,
  EndpointReferencePromise,
  ExecutableResourcePromise,
} from "../../.aspire/modules/aspire.mjs";
import type { GluetunResource } from "./gluetun.mjs";
import type {
  HttpResource,
  ResourceContext,
} from "./resource.mjs";

interface VpnProcessOptions {
  readonly name: string;
  readonly image: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly mounts: readonly (readonly [source: string, target: string])[];
}

export type VpnRoutedResource<
  TKind extends "qbittorrent" | "prowlarr",
> = HttpResource<
  TKind,
  ContainerResourcePromise | ExecutableResourcePromise
> &
  Readonly<{
    composeResource: ContainerResourcePromise;
  }>;

export function createVpnRoutedResource<
  const TKind extends "qbittorrent" | "prowlarr",
>(
  kind: TKind,
  resource: ContainerResourcePromise | ExecutableResourcePromise,
  composeResource: ContainerResourcePromise,
  http: EndpointReferencePromise,
): VpnRoutedResource<TKind> {
  return { kind, resource, composeResource, http };
}

export async function configureComposeVpnNetwork(
  composeResource: ContainerResourcePromise,
  gluetun: GluetunResource,
): Promise<void> {
  await composeResource.publishAsDockerComposeService(
    async (_compose, service) => {
      await service.networkMode.set(`service:${gluetun.kind}`);
      await service.ports.clear();
      await service.networks.clear();
      await service.restart.set("unless-stopped");
    },
  );
}

export function addVpnProcess(
  context: ResourceContext,
  gluetun: GluetunResource,
  options: VpnProcessOptions,
): ExecutableResourcePromise {
  if (
    gluetun.runContainerName === undefined ||
    gluetun.runInstanceId === undefined
  ) {
    throw new Error("Gluetun run identity is required in run mode.");
  }

  const runtime =
    process.env.ASPIRE_CONTAINER_RUNTIME ??
    (context.paths.containerSocket.includes("podman.sock")
      ? "podman"
      : "docker");
  const containerName = `arrspire-${gluetun.runInstanceId}-${options.name}`;
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--label",
    `io.arrspire.instance=${gluetun.runInstanceId}`,
    "--label",
    `io.arrspire.service=${options.name}`,
    "--network",
    `container:${gluetun.runContainerName}`,
  ];

  if (runtime === "podman" && context.paths.rootlessPodman) {
    args.push("--userns=keep-id");
  }

  for (const [name, value] of Object.entries({
    PUID: process.getuid?.().toString() ?? "1000",
    PGID: process.getgid?.().toString() ?? "1000",
    TZ: context.parameters.timezone,
    ...options.environment,
  })) {
    args.push("--env", `${name}=${value}`);
  }

  for (const [source, target] of options.mounts) {
    args.push("--volume", `${source}:${target}`);
  }
  args.push(options.image);

  return context.builder
    .addExecutable(`${options.name}-vpn`, "node", process.cwd(), [
      "scripts/run-vpn-container.mts",
      runtime,
      containerName,
      gluetun.runContainerName,
      String(process.pid),
      ...args,
    ])
    .withRequiredCommand("node")
    .withRequiredCommand(runtime)
    .waitFor(gluetun.resource);
}
