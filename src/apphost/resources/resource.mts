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

export abstract class ArrspireResource<
  TKind extends string,
  TResource extends ArrspireResourcePromise = ContainerResourcePromise,
> {
  protected constructor(
    readonly kind: TKind,
    readonly resource: TResource,
  ) {}

  get name(): TKind {
    return this.kind;
  }

  protected endpoint(name: string): EndpointReferencePromise {
    return this.resource.getEndpoint(name);
  }
}

export abstract class HttpResource<
  TKind extends string,
  TResource extends ArrspireResourcePromise = ContainerResourcePromise,
> extends ArrspireResource<TKind, TResource> {
  protected constructor(
    kind: TKind,
    resource: TResource,
    private readonly routedHttp?: EndpointReferencePromise,
  ) {
    super(kind, resource);
  }

  get http(): EndpointReferencePromise {
    return this.routedHttp ?? this.endpoint("http");
  }
}

export abstract class ArrApiResource<
  TKind extends "sonarr" | "radarr" | "lidarr" | "prowlarr",
  TResource extends ArrspireResourcePromise = ContainerResourcePromise,
> extends HttpResource<TKind, TResource> {
  abstract readonly apiVersion: "v1" | "v3";
  abstract readonly configDirectory: string;
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
