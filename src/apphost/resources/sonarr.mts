import { addArrApp } from "./arr-app.mjs";
import { images } from "../images.mjs";
import {
  type ArrApiResource,
  createHttpResource,
  type ResourceContext,
} from "./resource.mjs";

export type SonarrResource = ArrApiResource<"sonarr"> &
  Readonly<{
    apiVersion: "v3";
    configDirectory: "/data/sonarr";
  }>;

export function addSonarr(context: ResourceContext): SonarrResource {
  const resource = addArrApp(context, {
    name: "sonarr",
    image: images.sonarr,
    port: 8989,
    mediaDirectory: "tv",
  });

  return {
    ...createHttpResource("sonarr", resource),
    apiVersion: "v3",
    configDirectory: "/data/sonarr",
  };
}
