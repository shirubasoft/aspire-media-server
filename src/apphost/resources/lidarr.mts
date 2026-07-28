import { addArrApp } from "./arr-app.mjs";
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
    image: "ghcr.io/linuxserver/lidarr:latest",
    port: 8686,
    mediaDirectory: "music",
  });

  return {
    ...createHttpResource("lidarr", resource),
    apiVersion: "v1",
    configDirectory: "/data/lidarr",
  };
}
