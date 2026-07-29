import assert from "node:assert/strict";
import test from "node:test";

import {
  httpsServiceUrl,
  publishedTraefikHttpsPort,
  resolveIngressPorts,
} from "../ingress.mjs";

void test("rootless Podman defaults to unprivileged ingress ports", () => {
  assert.deepEqual(resolveIngressPorts(true, {}), {
    http: 8080,
    https: 8443,
  });
});

void test("rootful runtimes retain standard HTTP and HTTPS ports", () => {
  assert.deepEqual(resolveIngressPorts(false, {}), {
    http: 80,
    https: 443,
  });
});

void test("explicit ingress port overrides are validated", () => {
  assert.deepEqual(
    resolveIngressPorts(true, {
      ARRSPIRE_INGRESS_HTTP_PORT: "9080",
      ARRSPIRE_INGRESS_HTTPS_PORT: "9443",
    }),
    { http: 9080, https: 9443 },
  );
  assert.throws(
    () =>
      resolveIngressPorts(false, {
        ARRSPIRE_INGRESS_HTTP_PORT: "70000",
      }),
    /valid TCP port/u,
  );
  assert.throws(
    () =>
      resolveIngressPorts(false, {
        ARRSPIRE_INGRESS_HTTP_PORT: "8443",
        ARRSPIRE_INGRESS_HTTPS_PORT: "8443",
      }),
    /must differ/u,
  );
});

void test("status URLs reflect the HTTPS host port in the Compose artifact", () => {
  const compose = `services:
  traefik:
    image: traefik
    ports:
      - "8080:80"
      - "8443:443"
`;
  assert.equal(publishedTraefikHttpsPort(compose), 8443);
  assert.equal(
    httpsServiceUrl("sonarr", "192.168.0.15.nip.io", 8443),
    "https://sonarr.192.168.0.15.nip.io:8443",
  );
  assert.equal(
    httpsServiceUrl("jellyfin", "localhost", 443),
    "https://jellyfin.localhost",
  );
});
