import { addArrApp } from "./arr-app.mjs";
import { images } from "../images.mjs";
import {
  type ArrApiResource,
  createHttpResource,
  type ResourceContext,
} from "./resource.mjs";

export type RadarrResource = ArrApiResource<"radarr"> &
  Readonly<{
    apiVersion: "v3";
    configDirectory: "/data/radarr";
  }>;

export function addRadarr(context: ResourceContext): RadarrResource {
  const resource = addArrApp(context, {
    name: "radarr",
    image: images.radarr,
    port: 7878,
    mediaDirectory: "movies",
  });

  return {
    ...createHttpResource("radarr", resource),
    apiVersion: "v3",
    configDirectory: "/data/radarr",
  };
}
