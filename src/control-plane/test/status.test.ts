import assert from "node:assert/strict";
import test from "node:test";

import { classifyReadiness } from "../src/status.js";

void test("classifies ready, partial-success, and failed reconciliation", () => {
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
    "degraded",
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
