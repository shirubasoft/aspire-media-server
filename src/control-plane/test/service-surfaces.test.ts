import assert from "node:assert/strict";
import test from "node:test";

import {
  authenticationDescription,
  requiresIngressAuthentication,
  serviceSurface,
  serviceSurfaces,
} from "../src/service-surfaces.js";

void test("defines each external service surface exactly once", () => {
  assert.equal(
    new Set(serviceSurfaces.map((surface) => surface.name)).size,
    serviceSurfaces.length,
  );
});

void test("describes service and layered authentication accurately", () => {
  assert.equal(serviceSurface("auth").authentication, "identity");
  assert.equal(
    authenticationDescription(serviceSurface("auth").authentication),
    "Arrspire sign-in credentials",
  );
  assert.equal(serviceSurface("duplicati").authentication, "service");
  assert.equal(
    authenticationDescription(serviceSurface("qbittorrent").authentication),
    "Arrspire sign-in + service credentials",
  );
  assert.equal(
    authenticationDescription(serviceSurface("grafana").authentication),
    "Arrspire sign-in + service credentials",
  );
  assert.equal(
    requiresIngressAuthentication(
      serviceSurface("duplicati").authentication,
    ),
    false,
  );
  assert.equal(
    requiresIngressAuthentication(serviceSurface("sonarr").authentication),
    true,
  );
  assert.equal(
    requiresIngressAuthentication(serviceSurface("auth").authentication),
    false,
  );
});
