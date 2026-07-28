import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import { addArrApp } from "./arr-app.mjs";
import {
  ArrApiResource,
  type ResourceContext,
} from "./resource.mjs";

export class SonarrResource extends ArrApiResource<"sonarr"> {
  readonly apiVersion = "v3" as const;
  readonly configDirectory = "/data/sonarr";

  private constructor(resource: ContainerResourcePromise) {
    super("sonarr", resource);
  }

  static add(context: ResourceContext): SonarrResource {
    return new SonarrResource(
      addArrApp(context, {
        name: "sonarr",
        image: "ghcr.io/linuxserver/sonarr:latest",
        port: 8989,
        mediaDirectory: "tv",
      }),
    );
  }
}
