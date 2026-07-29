import assert from "node:assert/strict";
import test from "node:test";

import {
  fail2banFilter,
  runtimeDirectoryPlan,
  traefikDynamicConfiguration,
} from "../src/bootstrap.js";

void test("runtime media and download directories belong to the service user", () => {
  assert.deepEqual(runtimeDirectoryPlan(), [
    { path: "/data/grafana", uid: 472, gid: 0 },
    { path: "/data/prometheus", uid: 65_534, gid: 65_534 },
    { path: "/data/recyclarr", uid: 1000, gid: 1000 },
    {
      path: "/data/jellyseerr",
      uid: 1000,
      gid: 1000,
      recursive: true,
    },
    { path: "/media/movies", uid: 1000, gid: 1000 },
    { path: "/media/tv", uid: 1000, gid: 1000 },
    { path: "/media/music", uid: 1000, gid: 1000 },
    { path: "/downloads", uid: 1000, gid: 1000 },
    { path: "/downloads/incomplete", uid: 1000, gid: 1000 },
    { path: "/downloads/sonarr", uid: 1000, gid: 1000 },
    { path: "/downloads/radarr", uid: 1000, gid: 1000 },
    { path: "/downloads/lidarr", uid: 1000, gid: 1000 },
  ]);
});

void test("protects and routes the network-only Aspire dashboard", () => {
  const configuration = traefikDynamicConfiguration(
    "localhost",
    {
      aspire: {
        url: "http://arrspire-dashboard:18888",
        authentication: "ingress",
      },
    },
    "operator",
    "secret",
  );

  assert.match(
    configuration,
    /rule: 'Host\(`aspire\.localhost`\)'/u,
  );
  assert.match(configuration, /middlewares: \[admin-auth\]/u);
  assert.match(
    configuration,
    /url: "http:\/\/arrspire-dashboard:18888"/u,
  );
  assert.match(configuration, /tls: \{\}/u);
  assert.doesNotMatch(configuration, /certResolver/u);
});

void test("uses the ACME resolver only when public TLS is enabled", () => {
  const configuration = traefikDynamicConfiguration(
    "home.example.com",
    {
      jellyfin: {
        url: "http://jellyfin:8096",
        authentication: "service",
      },
    },
    "operator",
    "secret",
    "cloudflare-acme",
  );

  assert.match(
    configuration,
    /jellyfin:\n[\s\S]*?tls:\n        certResolver: letsencrypt/u,
  );
  assert.match(
    configuration,
    /traefik-dashboard:\n[\s\S]*?tls:\n        certResolver: letsencrypt/u,
  );
});

void test("lets Duplicati use its own Bearer authentication", () => {
  const configuration = traefikDynamicConfiguration(
    "localhost",
    {
      duplicati: {
        url: "http://duplicati:8200",
        authentication: "service",
      },
    },
    "operator",
    "secret",
  );

  assert.match(
    configuration,
    /duplicati:\n      rule: 'Host\(`duplicati\.localhost`\)'[\s\S]*?service: duplicati\n      tls: \{\}\n/u,
  );
  const router = configuration.match(
    /    duplicati:\n(?<configuration>(?:      .*\n)+)\n/u,
  );
  assert.ok(router?.groups?.configuration);
  assert.doesNotMatch(router.groups.configuration, /admin-auth/u);
});

void test("keeps the legacy Jellyseerr hostname as a Seerr alias", () => {
  const configuration = traefikDynamicConfiguration(
    "localhost",
    {
      seerr: {
        url: "http://seerr:5055",
        authentication: "service",
        aliases: ["jellyseerr"],
      },
    },
    "operator",
    "secret",
  );

  assert.match(
    configuration,
    /rule: 'Host\(`seerr\.localhost`\) \|\| Host\(`jellyseerr\.localhost`\)'/u,
  );
  assert.match(configuration, /url: "http:\/\/seerr:5055"/u);
});

void test("does not ban browser clients for ordinary missing routes", () => {
  assert.match(fail2banFilter, /\(401\|403\|429\)/u);
  assert.doesNotMatch(fail2banFilter, /404/u);
});
