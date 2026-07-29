import { join } from "node:path";
import { images } from "../images.mjs";

import type { ContainerResourcePromise } from "../../.aspire/modules/aspire.mjs";
import {
  type ArrspireResource,
  createResource,
  type ResourceContext,
} from "./resource.mjs";

export type RecyclarrResource = ArrspireResource<"recyclarr"> &
  Readonly<{
    sync: ContainerResourcePromise;
  }>;

export function addRecyclarr(
  context: ResourceContext,
): RecyclarrResource {
  const configDirectory = join(context.paths.data, "recyclarr");
  const sync = context.builder
    .addContainer("recyclarr-sync", images.recyclarr)
    // Keep the session container alive after the one-shot sync and report
    // healthy only when it succeeds. Aspire can occasionally miss a fast
    // Podman exit event, while health transitions are reliably observable.
    .withEntrypoint("/bin/bash")
    .withArgs([
      "-c",
      "set -euo pipefail; /app/recyclarr/recyclarr sync; printf '%s\\n' '#!/bin/sh' 'printf \"HTTP/1.1 200 OK\\r\\nContent-Length: 5\\r\\nConnection: close\\r\\n\\r\\nready\"' > /tmp/recyclarr-health; chmod +x /tmp/recyclarr-health; exec /usr/bin/nc -lk -p 8787 -e /tmp/recyclarr-health",
    ])
    .withEnvironment("TZ", context.parameters.timezone)
    .withBindMount(configDirectory, "/config")
    .withEndpoint({
      name: "health",
      scheme: "http",
      targetPort: 8787,
    })
    .withHttpHealthCheck({
      endpointName: "health",
      path: "/",
    });
  const resource = context.builder
    .addContainer(
      "recyclarr",
      images.recyclarr,
    )
    .withEnvironment("TZ", context.parameters.timezone)
    .withEnvironment("CRON_SCHEDULE", "@daily")
    .withBindMount(configDirectory, "/config");

  return {
    ...createResource("recyclarr", resource),
    sync,
  };
}
