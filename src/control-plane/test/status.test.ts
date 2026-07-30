import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReadiness,
  classifyResult,
  compactReason,
} from "../src/readiness.js";

void test("keeps intentionally unconfigured integrations operational", () => {
  assert.equal(
    classifyReadiness([
      { name: "sonarr", required: true, status: "ready" },
    ]),
    "ready",
  );
  assert.equal(
    classifyReadiness([
      { name: "sonarr", required: true, status: "ready" },
      {
        name: "subtitle-provider:optional",
        required: false,
        status: "skipped",
        reason: "credentials were not supplied",
      },
    ]),
    "ready",
  );
  assert.equal(
    classifyReadiness([
      { name: "sonarr", required: true, status: "ready" },
      {
        name: "public-indexer:optional",
        required: false,
        status: "failed",
      },
    ]),
    "attention",
  );
  assert.equal(
    classifyReadiness([
      {
        name: "sonarr",
        required: true,
        status: "failed",
        reason: "unavailable",
      },
      {
        name: "public-indexer:optional",
        required: false,
        status: "failed",
      },
    ]),
    "failed",
  );
});

void test("separates actionable, external, and unconfigured results", () => {
  assert.equal(
    classifyResult({
      name: "subtitle-provider:optional",
      required: false,
      status: "skipped",
    }),
    "not-configured",
  );
  assert.equal(
    classifyResult({
      name: "public-indexer:EZTV",
      required: false,
      status: "failed",
    }),
    "externally-unavailable",
  );
  assert.equal(
    classifyResult({
      name: "sonarr",
      required: true,
      status: "failed",
    }),
    "needs-attention",
  );
});

void test("condenses structured upstream failures for operator output", () => {
  assert.equal(
    compactReason(
      'HTTP 400 from Prowlarr: [{"errorMessage":"Blocked by Cloudflare protection"}]',
    ),
    "Blocked by Cloudflare protection",
  );
  assert.equal(
    compactReason("  a simple   failure\nwith whitespace "),
    "a simple failure with whitespace",
  );
});
