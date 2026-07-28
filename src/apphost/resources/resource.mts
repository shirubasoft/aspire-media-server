import type {
  ContainerResourcePromise,
  DistributedApplicationBuilder,
  EndpointReferencePromise,
  ExecutableResourcePromise,
} from "../../.aspire/modules/aspire.mjs";
import type { ArrspireParameters } from "../parameters.mjs";
import type { ArrspirePaths } from "../paths.mjs";

export interface ResourceContext {
  readonly builder: DistributedApplicationBuilder;
  readonly parameters: ArrspireParameters;
  readonly paths: ArrspirePaths;
  readonly isRunMode: boolean;
}

export type ArrspireResourcePromise =
  | ContainerResourcePromise
  | ExecutableResourcePromise;

export type ArrspireResource<
  TKind extends string,
  TResource extends ArrspireResourcePromise = ContainerResourcePromise,
> = Readonly<{
  kind: TKind;
  resource: TResource;
}>;

export type HttpResource<
  TKind extends string,
  TResource extends ArrspireResourcePromise = ContainerResourcePromise,
> = ArrspireResource<TKind, TResource> &
  Readonly<{
    http: EndpointReferencePromise;
  }>;

export type ArrApiResource<
  TKind extends "sonarr" | "radarr" | "lidarr" | "prowlarr",
  TResource extends ArrspireResourcePromise = ContainerResourcePromise,
> = HttpResource<TKind, TResource> &
  Readonly<{
    apiVersion: "v1" | "v3";
    configDirectory: string;
  }>;

export function createResource<
  const TKind extends string,
  TResource extends ArrspireResourcePromise,
>(
  kind: TKind,
  resource: TResource,
): ArrspireResource<TKind, TResource> {
  return { kind, resource };
}

export function createHttpResource<
  const TKind extends string,
  TResource extends ArrspireResourcePromise,
>(
  kind: TKind,
  resource: TResource,
  http = resource.getEndpoint("http"),
): HttpResource<TKind, TResource> {
  return { kind, resource, http };
}

export function withLinuxServerDefaults(
  resource: ContainerResourcePromise,
  context: ResourceContext,
): ContainerResourcePromise {
  let configured = resource
    .withEnvironment("PUID", process.getuid?.().toString() ?? "1000")
    .withEnvironment("PGID", process.getgid?.().toString() ?? "1000")
    .withEnvironment("TZ", context.parameters.timezone);

  if (context.paths.rootlessPodman) {
    configured = configured.withContainerRuntimeArgs(["--userns=keep-id"]);
  }

  return configured;
}

export function exposeHttp(
  resource: ContainerResourcePromise,
  port: number,
  healthPath: string,
  endpointName = "http",
): ContainerResourcePromise {
  return resource
    .withHttpEndpoint({
      name: endpointName,
      port,
      targetPort: port,
    })
    .withHttpHealthCheck({
      endpointName,
      path: healthPath,
    })
    .withExternalHttpEndpoints();
}

export async function withComposeRestart(
  resource: ContainerResourcePromise,
  policy = "unless-stopped",
): Promise<void> {
  await resource.publishAsDockerComposeService(async (_compose, service) => {
    await service.restart.set(policy);
  });
}
