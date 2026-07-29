import { join } from "node:path";

import { refExpr } from "../../.aspire/modules/aspire.mjs";
import { resolveIngressPorts } from "../ingress.mjs";
import { images } from "../images.mjs";
import {
  createHttpResource,
  exposeHttp,
  type HttpResource,
  type ResourceContext,
} from "./resource.mjs";

export type HomepageResource = HttpResource<"homepage">;

export async function addHomepage(
  context: ResourceContext,
): Promise<HomepageResource> {
  const httpsPort = resolveIngressPorts(context.paths.rootlessPodman).https;
  const domain = await context.parameters.traefikDomain;
  const resource = exposeHttp(
    context.builder
      .addContainer("homepage", images.homepage)
      .withEnvironment("LOG_TARGETS", "stdout")
      .withEnvironment(
        "HOMEPAGE_ALLOWED_HOSTS",
        refExpr`${domain},home.${domain},${domain}:${httpsPort},home.${domain}:${httpsPort}`,
      )
      .withEnvironment(
        "HOMEPAGE_FILE_SONARR_KEY",
        "/app/config/secrets/sonarr-key",
      )
      .withEnvironment(
        "HOMEPAGE_FILE_RADARR_KEY",
        "/app/config/secrets/radarr-key",
      )
      .withEnvironment(
        "HOMEPAGE_FILE_LIDARR_KEY",
        "/app/config/secrets/lidarr-key",
      )
      .withEnvironment(
        "HOMEPAGE_FILE_PROWLARR_KEY",
        "/app/config/secrets/prowlarr-key",
      )
      .withEnvironment(
        "HOMEPAGE_FILE_QBITTORRENT_PASSWORD",
        "/app/config/secrets/qbittorrent-password",
      )
      .withBindMount(
        join(context.paths.data, "homepage"),
        "/app/config",
        { isReadOnly: true },
      ),
    3000,
    "/",
  );

  return createHttpResource("homepage", resource);
}
