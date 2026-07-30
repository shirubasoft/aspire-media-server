import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  notifyReconciliation,
  ntfyConfiguration,
} from "../src/notifications.js";
import type { ReconciliationResult } from "../src/readiness.js";

void test("treats ntfy as opt-in and validates configured topics", () => {
  assert.equal(ntfyConfiguration({}), undefined);
  assert.deepEqual(
    ntfyConfiguration({
      NTFY_ENDPOINT: "https://notify.example.com",
      NTFY_TOPIC: "arrspire_alerts",
      NTFY_TOKEN: "access-token",
      ARRSPIRE_HOME_URL: "https://media.example.com",
    }),
    {
      endpoint: "https://notify.example.com/",
      topic: "arrspire_alerts",
      token: "access-token",
      click: "https://media.example.com",
    },
  );
  assert.throws(
    () => ntfyConfiguration({ NTFY_TOPIC: "invalid topic" }),
    /NTFY_TOPIC/u,
  );
});

void test("only sends reconciliation changes and recovery", async () => {
  const messages: unknown[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      messages.push(
        JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
      );
      response.writeHead(200);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const stateDirectory = await mkdtemp(join(tmpdir(), "arrspire-notify-"));
  const statePath = join(stateDirectory, "state.json");
  const configuration = {
    endpoint: `http://127.0.0.1:${String(address.port)}`,
    topic: "arrspire",
  };
  const failure: readonly ReconciliationResult[] = [
    {
      name: "sonarr",
      required: true,
      status: "failed",
      reason: "connection refused",
    },
  ];
  const ready: readonly ReconciliationResult[] = [
    { name: "sonarr", required: true, status: "ready" },
  ];

  try {
    assert.deepEqual(
      await notifyReconciliation(failure, configuration, statePath),
      { configured: true, sent: true },
    );
    assert.deepEqual(
      await notifyReconciliation(failure, configuration, statePath),
      { configured: true, sent: false },
    );
    assert.deepEqual(
      await notifyReconciliation(ready, configuration, statePath),
      { configured: true, sent: true },
    );
    assert.equal(messages.length, 2);
    assert.match(JSON.stringify(messages[0]), /connection refused/u);
    assert.match(JSON.stringify(messages[1]), /recovered/u);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});
