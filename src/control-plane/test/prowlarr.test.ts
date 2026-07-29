import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { ProwlarrClient } from "../src/prowlarr.js";

void test("configures a music-capable public indexer for Lidarr", async (context) => {
  const createdIndexers: string[] = [];
  const applications = ["Sonarr", "Radarr", "Lidarr"].map(
    (implementation, index) => ({
      id: index + 1,
      name: implementation,
      implementation,
      fields: [],
    }),
  );
  const indexerSchemas = ["EZTV", "Knaben", "LimeTorrents", "YTS"].map(
    (name) => ({ name, fields: [] }),
  );
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const path = request.url ?? "/";
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = bodyText
        ? (JSON.parse(bodyText) as Record<string, unknown>)
        : {};
      response.setHeader("Content-Type", "application/json");
      if (path === "/api/v1/config/host") {
        response.end(
          JSON.stringify({
            proxyEnabled: true,
            proxyType: "http",
            proxyHostname: "gluetun",
            proxyPort: 8888,
            proxyUsername: "",
            proxyPassword: "",
            proxyBypassFilter: "",
            proxyBypassLocalAddresses: true,
          }),
        );
      } else if (path === "/api/v1/applications") {
        response.end(JSON.stringify(applications));
      } else if (path === "/api/v1/applications/schema") {
        response.end("[]");
      } else if (
        request.method === "GET" &&
        path === "/api/v1/indexer"
      ) {
        response.end("[]");
      } else if (path === "/api/v1/indexer/schema") {
        response.end(JSON.stringify(indexerSchemas));
      } else {
        if (request.method === "POST" && path === "/api/v1/indexer") {
          assert.equal(typeof body.name, "string");
          createdIndexers.push(body.name as string);
        }
        response.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const client = new ProwlarrClient(baseUrl, "prowlarr-api-key");

  await client.reconcile(
    "http://gluetun:8888",
    applications.map(({ name }) => ({
      name: name as "Sonarr" | "Radarr" | "Lidarr",
      url: `http://${name.toLowerCase()}:1234`,
      apiKey: `${name.toLowerCase()}-api-key`,
      categories: [3000],
    })),
  );

  assert.ok(
    createdIndexers.includes("Knaben"),
    "Knaben must be configured so Lidarr receives a working music indexer",
  );
});
