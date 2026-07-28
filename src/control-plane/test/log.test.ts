import assert from "node:assert/strict";
import test from "node:test";

import { redactForLogging } from "../src/log.js";

void test("redacts sensitive keys, embedded credentials, and known secrets", () => {
  const previous = process.env.TEST_PASSWORD;
  process.env.TEST_PASSWORD = "super-secret-value";
  try {
    assert.deepEqual(
      redactForLogging({
        apiKey: "service-api-key",
        nested: {
          error:
            'HTTP error password="inline-value" token=abc123 super-secret-value',
          url: "https://operator:password@example.test/path",
        },
      }),
      {
        apiKey: "[REDACTED]",
        nested: {
          error:
            'HTTP error password="[REDACTED]" token=[REDACTED] [REDACTED]',
          url: "https://[REDACTED]@example.test/path",
        },
      },
    );
  } finally {
    if (previous === undefined) {
      delete process.env.TEST_PASSWORD;
    } else {
      process.env.TEST_PASSWORD = previous;
    }
  }
});
