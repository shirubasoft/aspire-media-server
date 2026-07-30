import assert from "node:assert/strict";
import test from "node:test";

import {
  autheliaConfiguration,
  autheliaPasswordDigest,
  autheliaUsersDatabase,
  fail2banFilter,
  homepageServices,
  homepageSettings,
  runtimeDirectoryPlan,
  traefikDynamicConfiguration,
} from "../src/bootstrap.js";

const autheliaUrl = "http://authelia:9091";

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
    autheliaUrl,
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
    autheliaUrl,
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
    autheliaUrl,
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
    autheliaUrl,
  );

  assert.match(
    configuration,
    /rule: 'Host\(`seerr\.localhost`\) \|\| Host\(`jellyseerr\.localhost`\)'/u,
  );
  assert.match(configuration, /url: "http:\/\/seerr:5055"/u);
});

void test("routes the bare domain and home alias to the protected portal", () => {
  const configuration = traefikDynamicConfiguration(
    "home.example.com",
    {
      homepage: {
        url: "http://homepage:3000",
        authentication: "ingress",
        hosts: ["home.example.com", "home.home.example.com"],
      },
    },
    autheliaUrl,
  );

  assert.match(
    configuration,
    /rule: 'Host\(`home\.example\.com`\) \|\| Host\(`home\.home\.example\.com`\)'/u,
  );
  assert.match(
    configuration,
    /homepage:\n[\s\S]*?middlewares: \[admin-auth\]/u,
  );
});

void test("delegates administrative authentication to Authelia", () => {
  const configuration = traefikDynamicConfiguration(
    "home.example.com",
    {
      auth: {
        url: autheliaUrl,
        authentication: "identity",
      },
      homepage: {
        url: "http://homepage:3000",
        authentication: "ingress",
      },
    },
    autheliaUrl,
  );

  assert.match(
    configuration,
    /forwardAuth:\n        address: "http:\/\/authelia:9091\/api\/authz\/forward-auth"/u,
  );
  assert.match(configuration, /maxResponseBodySize: 8192/u);
  assert.match(configuration, /authResponseHeaders:/u);
  const authRouter = configuration.match(
    /    auth:\n(?<configuration>(?:      .*\n)+)\n/u,
  );
  assert.ok(authRouter?.groups?.configuration);
  assert.doesNotMatch(authRouter.groups.configuration, /admin-auth/u);
  assert.doesNotMatch(configuration, /basicAuth/u);
});

void test("generates stable Authelia credentials and shared-domain sessions", () => {
  const first = autheliaPasswordDigest("correct horse", "stable salt source");
  const second = autheliaPasswordDigest("correct horse", "stable salt source");
  assert.equal(first, second);
  assert.match(
    first,
    /^\$scrypt\$ln=16,r=8,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/u,
  );
  assert.notEqual(
    first,
    autheliaPasswordDigest("different password", "stable salt source"),
  );

  const users = autheliaUsersDatabase(
    "operator",
    "correct horse",
    "s".repeat(64),
    "home.example.com",
  );
  assert.match(users, /"operator":/u);
  assert.match(users, /password: "\$scrypt\$/u);
  assert.doesNotMatch(users, /correct horse/u);

  const configuration = autheliaConfiguration("home.example.com", 8443);
  assert.match(configuration, /domain: "home\.example\.com"/u);
  assert.match(
    configuration,
    /authelia_url: "https:\/\/auth\.home\.example\.com:8443"/u,
  );
  assert.match(
    configuration,
    /default_redirection_url: "https:\/\/home\.example\.com:8443"/u,
  );
  assert.match(configuration, /policy: one_factor/u);
  assert.doesNotMatch(configuration, /secret:/u);
  assert.doesNotMatch(configuration, /encryption_key:/u);
});

void test("generates a secure, useful Homepage configuration", () => {
  const services = Object.fromEntries(
    [
      "aspire",
      "auth",
      "bazarr",
      "duplicati",
      "grafana",
      "jellyfin",
      "lidarr",
      "prometheus",
      "prowlarr",
      "qbittorrent",
      "radarr",
      "seerr",
      "sonarr",
      "tdarr",
    ].map((name) => [
      name,
      {
        url: `http://${name}:1234`,
        authentication: "ingress" as const,
      },
    ]),
  );
  const configuration = homepageServices(
    "home.example.com",
    8443,
    services,
  );

  assert.match(homepageSettings(), /disableIndexing: true/u);
  assert.match(
    configuration,
    /href: "https:\/\/jellyfin\.home\.example\.com:8443"/u,
  );
  assert.match(
    configuration,
    /- Authelia:\n[\s\S]*?href: "https:\/\/auth\.home\.example\.com:8443"[\s\S]*?siteMonitor: "http:\/\/auth:1234\/api\/health"/u,
  );
  assert.match(configuration, /type: sonarr/u);
  assert.match(
    configuration,
    /key: "\{\{HOMEPAGE_FILE_SONARR_KEY\}\}"/u,
  );
  assert.match(
    configuration,
    /password: "\{\{HOMEPAGE_FILE_QBITTORRENT_PASSWORD\}\}"/u,
  );
  assert.doesNotMatch(configuration, /api-key-value|password-value/u);
});

void test("does not ban browser clients for ordinary missing routes", () => {
  assert.match(fail2banFilter, /\(401\|403\|429\)/u);
  assert.doesNotMatch(fail2banFilter, /404/u);
});
