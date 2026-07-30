import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { SeerrClient } from "../src/seerr.js";

void test("repairs initialized Seerr service endpoints", async (context) => {
  const requests: Array<{
    readonly method: string;
    readonly path: string;
    readonly body: Record<string, unknown>;
    readonly apiKey?: string;
  }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const path = request.url ?? "/";
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = bodyText
        ? (JSON.parse(bodyText) as Record<string, unknown>)
        : {};
      const apiKey = request.headers["x-api-key"];
      requests.push({
        method: request.method ?? "GET",
        path,
        body,
        ...(typeof apiKey === "string" ? { apiKey } : {}),
      });
      response.setHeader("Content-Type", "application/json");
      if (path === "/api/v1/settings/public") {
        response.end('{"initialized":true}');
      } else if (path === "/api/v1/settings/sonarr") {
        response.end('[{"id":11,"name":"Sonarr","hostname":null}]');
      } else if (path === "/api/v1/settings/radarr") {
        response.end('[{"id":22,"name":"Radarr","hostname":null}]');
      } else if (path.endsWith("/api/v3/qualityprofile")) {
        response.end(
          path.startsWith("/sonarr")
            ? '[{"id":1,"name":"HD-1080p"},{"id":7,"name":"[Anime] Remux-1080p"}]'
            : '[{"id":1,"name":"HD-1080p"}]',
        );
      } else if (path.endsWith("/api/v3/rootfolder")) {
        response.end(
          path.startsWith("/sonarr")
            ? '[{"path":"/tv"}]'
            : '[{"path":"/movies"}]',
        );
      } else {
        response.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve)
  );
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const client = new SeerrClient(
    baseUrl,
    "http://jellyfin:8096",
    "admin",
    "secret",
    "seerr-api-key",
  );

  await client.reconcile(
    `${baseUrl}/sonarr`,
    "sonarr-api-key",
    `${baseUrl}/radarr`,
    "radarr-api-key",
    {
      sonarr: "https://sonarr.example.test:9443",
      radarr: "https://radarr.example.test:9443",
    },
  );

  const jellyfinUpdate = requests.find(
    (request) =>
      request.method === "POST" &&
      request.path === "/api/v1/settings/jellyfin",
  );
  assert.equal(jellyfinUpdate?.apiKey, "seerr-api-key");
  assert.deepEqual(jellyfinUpdate?.body, {
    ip: "jellyfin",
    port: 8096,
    useSsl: false,
    urlBase: "",
    externalHostname: "",
  });
  assert.ok(
    requests.some(
      (request) =>
        request.method === "PUT" &&
        request.path === "/api/v1/settings/sonarr/11" &&
        request.body.hostname === "127.0.0.1" &&
        request.body.port === address.port &&
        request.body.useSsl === false &&
        request.body.animeSeriesType === "anime" &&
        request.body.activeAnimeProfileId === 7 &&
        request.body.activeAnimeProfileName === "[Anime] Remux-1080p" &&
        request.body.activeAnimeDirectory === "/tv" &&
        request.body.externalUrl ===
          "https://sonarr.example.test:9443",
    ),
  );
  assert.ok(
    requests.some(
      (request) =>
        request.method === "PUT" &&
        request.path === "/api/v1/settings/radarr/22" &&
        request.body.hostname === "127.0.0.1" &&
        request.body.port === address.port &&
        request.body.useSsl === false &&
        request.body.externalUrl ===
          "https://radarr.example.test:9443",
    ),
  );
});
