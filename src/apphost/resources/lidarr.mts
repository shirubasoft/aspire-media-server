import { addArrApp } from "./arr-app.mjs";
import { images } from "../images.mjs";
import {
  type ArrApiResource,
  createHttpResource,
  type ResourceContext,
} from "./resource.mjs";

export type LidarrResource = ArrApiResource<"lidarr"> &
  Readonly<{
    apiVersion: "v1";
    configDirectory: "/data/lidarr";
  }>;

export function addLidarr(context: ResourceContext): LidarrResource {
  const resource = addArrApp(context, {
    name: "lidarr",
    image: images.lidarr,
    port: 8686,
    mediaDirectory: "music",
  });

  return {
    ...createHttpResource("lidarr", resource),
    apiVersion: "v1",
    configDirectory: "/data/lidarr",
  };
}
