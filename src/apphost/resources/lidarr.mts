import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import { addArrApp } from "./arr-app.mjs";
import {
  ArrApiResource,
  type ResourceContext,
} from "./resource.mjs";

export class LidarrResource extends ArrApiResource<"lidarr"> {
  readonly apiVersion = "v1" as const;
  readonly configDirectory = "/data/lidarr";

  private constructor(resource: ContainerResourcePromise) {
    super("lidarr", resource);
  }

  static add(context: ResourceContext): LidarrResource {
    return new LidarrResource(
      addArrApp(context, {
        name: "lidarr",
        image: "ghcr.io/linuxserver/lidarr:latest",
        port: 8686,
        mediaDirectory: "music",
      }),
    );
  }
}
