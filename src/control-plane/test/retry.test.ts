import assert from "node:assert/strict";
import test from "node:test";

import { retry } from "../src/retry.js";

void test("retry returns after a transient failure", async () => {
  let calls = 0;
  const waits: number[] = [];
  const result = await retry(
    () => {
      calls += 1;
      if (calls < 3) {
        throw new Error("transient");
      }
      return Promise.resolve("converged");
    },
    {
      attempts: 4,
      initialDelayMs: 10,
      maximumDelayMs: 15,
      wait: (delayMs) => {
        waits.push(delayMs);
        return Promise.resolve();
      },
    },
  );

  assert.equal(result, "converged");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 15]);
});

void test("retry preserves the final error", async () => {
  const expected = new Error("permanent");
  await assert.rejects(
    retry(() => Promise.reject(expected), {
      attempts: 2,
      initialDelayMs: 1,
      maximumDelayMs: 1,
      wait: () => Promise.resolve(),
    }),
    (error) => error === expected,
  );
});
