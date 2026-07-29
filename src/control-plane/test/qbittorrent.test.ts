import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { QBittorrentClient } from "../src/qbittorrent.js";

void test("disables the redundant HTTP proxy for a VPN-networked qBittorrent", async (context) => {
  let changedPreferences: Record<string, unknown> | undefined;
  const changedCategories: Record<string, string> = {};
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const path = request.url ?? "/";
      const body = Buffer.concat(chunks).toString("utf8");
      if (path === "/api/v2/auth/login") {
        response.setHeader("Set-Cookie", "SID=test-session; HttpOnly");
        response.end("Ok.");
      } else if (path === "/api/v2/app/preferences") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            proxy_type: "HTTP",
            proxy_ip: "gluetun",
            proxy_port: 8888,
            proxy_peer_connections: true,
            proxy_hostname_lookup: true,
            proxy_bittorrent: true,
            proxy_misc: true,
            proxy_rss: true,
          }),
        );
      } else if (path === "/api/v2/torrents/categories") {
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            sonarr: { savePath: "/tv" },
            radarr: { savePath: "/movies" },
            lidarr: { savePath: "/music" },
          }),
        );
      } else if (path === "/api/v2/app/setPreferences") {
        const encoded = new URLSearchParams(body).get("json");
        assert.ok(encoded);
        changedPreferences = JSON.parse(encoded) as Record<string, unknown>;
        response.end();
      } else if (path === "/api/v2/torrents/editCategory") {
        const form = new URLSearchParams(body);
        const category = form.get("category");
        const savePath = form.get("savePath");
        assert.ok(category);
        assert.ok(savePath);
        changedCategories[category] = savePath;
        response.end();
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
  const client = new QBittorrentClient(
    `http://127.0.0.1:${String(address.port)}`,
    "admin",
    "secret",
  );

  await client.reconcile();

  assert.equal(changedPreferences?.proxy_type, "None");
  assert.equal(changedPreferences?.proxy_peer_connections, false);
  assert.equal(changedPreferences?.proxy_bittorrent, false);
  assert.equal(changedPreferences?.proxy_misc, false);
  assert.equal(changedPreferences?.proxy_rss, false);
  assert.deepEqual(changedCategories, {
    sonarr: "/downloads/sonarr",
    radarr: "/downloads/radarr",
    lidarr: "/downloads/lidarr",
  });
});
