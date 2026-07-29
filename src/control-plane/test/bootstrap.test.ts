import assert from "node:assert/strict";
import test from "node:test";

import {
  runtimeDirectoryPlan,
  traefikDynamicConfiguration,
} from "../src/bootstrap.js";

void test("runtime media and download directories belong to the service user", () => {
  assert.deepEqual(runtimeDirectoryPlan(), [
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
        requiresIngressAuthentication: true,
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
});

void test("lets Duplicati use its own Bearer authentication", () => {
  const configuration = traefikDynamicConfiguration(
    "localhost",
    {
      duplicati: {
        url: "http://duplicati:8200",
        requiresIngressAuthentication: false,
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
