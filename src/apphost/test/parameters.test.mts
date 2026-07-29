import assert from "node:assert/strict";
import test from "node:test";

import { parameterValue } from "../parameters.mjs";

void test("parameterValue maps kebab-case Aspire names to portable environment names", () => {
  assert.equal(
    parameterValue("traefik-domain", "fallback.example", {
      Parameters__traefik_domain: "home.example.com",
    }),
    "home.example.com",
  );
});

void test("parameterValue returns the fallback when no deployment input exists", () => {
  assert.equal(parameterValue("traefik-tls-mode", "local", {}), "local");
});
