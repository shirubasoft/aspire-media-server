import type {
  ContainerResourcePromise,
  EndpointReferencePromise,
} from "../../.aspire/modules/aspire.mjs";
import type {
  ArrspireResourcePromise,
  ResourceContext,
} from "./resource.mjs";

export type ControlPlaneEndpoints = Readonly<
  Record<string, EndpointReferencePromise>
>;

export function addControlPlaneContainer(
  context: ResourceContext,
  name: "bootstrap" | "reconciler" | "acceptance",
  command: "bootstrap" | "reconcile" | "verify",
): ContainerResourcePromise {
  return context.builder
    .addDockerfile(name, ".", {
      dockerfilePath: "control-plane/Dockerfile",
    })
    .withArgs([command])
    .withBindMount(context.paths.data, "/data")
    .withBindMount(context.paths.media, "/media")
    .withBindMount(context.paths.downloads, "/downloads");
}

export function withEndpointEnvironment(
  resource: ContainerResourcePromise,
  endpoints: ControlPlaneEndpoints,
): ContainerResourcePromise {
  let configured = resource;

  for (const [name, endpoint] of Object.entries(endpoints)) {
    const environmentName = name
      .replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2")
      .replaceAll("-", "_")
      .toUpperCase();
    configured = configured.withEnvironment(
      `${environmentName}_URL`,
      endpoint,
    );
  }

  return configured;
}

export function waitForResources(
  resource: ContainerResourcePromise,
  dependencies: readonly ArrspireResourcePromise[],
): ContainerResourcePromise {
  let configured = resource;
  for (const dependency of dependencies) {
    configured = configured.waitFor(dependency);
  }
  return configured;
}
