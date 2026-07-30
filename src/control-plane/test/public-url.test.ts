import assert from "node:assert/strict";
import test from "node:test";

import { publicServiceUrl } from "../src/public-url.js";

void test("builds public service URLs with the deployed HTTPS port", () => {
  assert.equal(
    publicServiceUrl("sonarr", "home.example.test", 8443),
    "https://sonarr.home.example.test:8443",
  );
  assert.equal(
    publicServiceUrl("radarr", "home.example.test", 443),
    "https://radarr.home.example.test",
  );
});

void test("rejects invalid public HTTPS ports", () => {
  assert.throws(
    () => publicServiceUrl("sonarr", "home.example.test", 70_000),
    /valid TCP port/u,
  );
});
