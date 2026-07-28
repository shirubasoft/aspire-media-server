import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import { addArrApp } from "./arr-app.mjs";
import {
  ArrApiResource,
  type ResourceContext,
} from "./resource.mjs";

export class RadarrResource extends ArrApiResource<"radarr"> {
  readonly apiVersion = "v3" as const;
  readonly configDirectory = "/data/radarr";

  private constructor(resource: ContainerResourcePromise) {
    super("radarr", resource);
  }

  static add(context: ResourceContext): RadarrResource {
    return new RadarrResource(
      addArrApp(context, {
        name: "radarr",
        image: "ghcr.io/linuxserver/radarr:latest",
        port: 7878,
        mediaDirectory: "movies",
      }),
    );
  }
}
