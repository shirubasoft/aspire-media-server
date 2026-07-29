import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  DuplicatiClient,
  duplicatiBackupDefinition,
} from "../src/duplicati.js";

void test("provisions an encrypted daily configuration backup", async (context) => {
  const requests: Array<{
    readonly method: string;
    readonly path: string;
    readonly authorization?: string;
    readonly body: unknown;
  }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method: request.method ?? "GET",
        path: request.url ?? "/",
        ...(request.headers.authorization === undefined
          ? {}
          : { authorization: request.headers.authorization }),
        body: bodyText === "" ? undefined : JSON.parse(bodyText),
      });
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/v1/auth/login") {
        response.end(JSON.stringify({ AccessToken: "access-token" }));
      } else if (
        request.url === "/api/v1/backups" &&
        request.method === "GET"
      ) {
        response.end(JSON.stringify([]));
      } else if (
        request.url === "/api/v1/backups" &&
        request.method === "POST"
      ) {
        response.end(JSON.stringify({ ID: "1" }));
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  await new DuplicatiClient(
    `http://127.0.0.1:${String(address.port)}`,
    "web-password",
    "encryption-key",
  ).reconcile();

  assert.deepEqual(requests, [
    {
      method: "POST",
      path: "/api/v1/auth/login",
      body: { Password: "web-password" },
    },
    {
      method: "GET",
      path: "/api/v1/backups",
      authorization: "Bearer access-token",
      body: undefined,
    },
    {
      method: "POST",
      path: "/api/v1/backups",
      authorization: "Bearer access-token",
      body: duplicatiBackupDefinition("encryption-key"),
    },
  ]);
});

void test("preserves an existing Arrspire backup", async (context) => {
  let createRequests = 0;
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/v1/auth/login") {
        response.end(JSON.stringify({ AccessToken: "access-token" }));
      } else if (
        request.url === "/api/v1/backups" &&
        request.method === "GET"
      ) {
        response.end(
          JSON.stringify([
            { Backup: { ID: "7", Name: "Arrspire Configuration" } },
          ]),
        );
      } else if (
        request.url === "/api/v1/backups" &&
        request.method === "POST"
      ) {
        createRequests += 1;
        response.end(JSON.stringify({ ID: "8" }));
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  await new DuplicatiClient(
    `http://127.0.0.1:${String(address.port)}`,
    "web-password",
    "encryption-key",
  ).reconcile();

  assert.equal(createRequests, 0);
});
