import { refExpr } from "../../.aspire/modules/aspire.mjs";
import { resolveIngressPorts } from "../ingress.mjs";
import {
  addControlPlaneContainer,
  type ControlPlaneEndpoints,
  withEndpointEnvironment,
} from "./control-plane.mjs";
import {
  createHttpResource,
  exposeHttp,
  type HttpResource,
  type ResourceContext,
} from "./resource.mjs";

export type NotifierResource = HttpResource<"notifier">;

export async function addNotifier(
  context: ResourceContext,
  endpoints: ControlPlaneEndpoints,
): Promise<NotifierResource> {
  const domain = await context.parameters.traefikDomain;
  const httpsPort = resolveIngressPorts(context.paths.rootlessPodman).https;
  const port = httpsPort === 443 ? "" : `:${String(httpsPort)}`;
  const resource = exposeHttp(
    withEndpointEnvironment(
      addControlPlaneContainer(
        context,
        "notifier",
        "serve-notifications",
        false,
      )
        .withEnvironment("NTFY_ENDPOINT", context.parameters.ntfyEndpoint)
        .withEnvironment("NTFY_TOPIC", context.parameters.ntfyTopic)
        .withEnvironment("NTFY_TOKEN", context.parameters.ntfyToken)
        .withEnvironment(
          "ARRSPIRE_HOME_URL",
          refExpr`https://${domain}${port}`,
        ),
      endpoints,
    ),
    8080,
    "/healthz",
  );

  return createHttpResource("notifier", resource);
}
