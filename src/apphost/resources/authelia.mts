import { join } from "node:path";

import { images } from "../images.mjs";
import {
  createHttpResource,
  exposeHttp,
  type HttpResource,
  type ResourceContext,
} from "./resource.mjs";

export type AutheliaResource = HttpResource<"authelia">;

export function addAuthelia(
  context: ResourceContext,
): AutheliaResource {
  const resource = exposeHttp(
    context.builder
      .addContainer("authelia", images.authelia)
      .withEnvironment("TZ", context.parameters.timezone)
      .withEnvironment(
        "AUTHELIA_SESSION_SECRET_FILE",
        "/secrets/session-secret",
      )
      .withEnvironment(
        "AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE",
        "/secrets/storage-encryption-key",
      )
      .withBindMount(
        join(context.paths.data, "authelia", "config"),
        "/config",
      )
      .withBindMount(
        join(context.paths.data, "authelia", "secrets"),
        "/secrets",
        { isReadOnly: true },
      ),
    9091,
    "/api/health",
  );

  return createHttpResource("authelia", resource);
}
