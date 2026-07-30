import assert from "node:assert/strict";
import test from "node:test";

import {
  localeProfiles,
  optionalCredentialStates,
  validateConfiguration,
} from "../src/validation.js";

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    VPN_PROVIDER: "protonvpn",
    VPN_COUNTRIES: "Netherlands",
    VPN_WIREGUARD_KEY: Buffer.alloc(32, 7).toString("base64"),
    TIMEZONE: "America/Sao_Paulo",
    JELLYFIN_LANGUAGE: "pt-BR",
    SUBTITLE_LANGUAGES: "pt-BR,en",
    MINIMUM_SEEDERS: "1",
    USE_ORIGINAL_TITLE: "false",
    TRAEFIK_DOMAIN: "192.168.0.15.nip.io",
    INGRESS_ADMIN_USER: "admin",
    INGRESS_ADMIN_PASSWORD: "not-logged-anywhere",
    AUTHELIA_SESSION_SECRET: "s".repeat(64),
    AUTHELIA_STORAGE_ENCRYPTION_KEY: "e".repeat(64),
  };
}

void test("validates the Portuguese and neutral locale profiles", () => {
  assert.deepEqual(localeProfiles["pt-BR"], {
    timezone: "America/Sao_Paulo",
    jellyfinLanguage: "pt-BR",
    subtitleLanguages: ["pt-BR"],
  });
  assert.deepEqual(localeProfiles.neutral, {
    timezone: "UTC",
    jellyfinLanguage: "en-US",
    subtitleLanguages: ["en"],
  });
  assert.doesNotThrow(() => validateConfiguration(validEnvironment()));
});

void test("rejects invalid VPN provider/country combinations and key material", () => {
  assert.throws(
    () =>
      validateConfiguration({
        ...validEnvironment(),
        VPN_PROVIDER: "custom",
      }),
    /incompatible/u,
  );
  assert.throws(
    () =>
      validateConfiguration({
        ...validEnvironment(),
        VPN_COUNTRIES: "Netherlands,,Brazil",
      }),
    /comma-separated/u,
  );
  assert.throws(
    () =>
      validateConfiguration({
        ...validEnvironment(),
        VPN_WIREGUARD_KEY: "not-a-key",
      }),
    /32 bytes/u,
  );
});

void test("rejects invalid timezone, locale, list, and numeric settings", () => {
  assert.throws(
    () =>
      validateConfiguration({
        ...validEnvironment(),
        TIMEZONE: "Mars/Olympus",
      }),
    /IANA timezone/u,
  );
  assert.throws(
    () =>
      validateConfiguration({
        ...validEnvironment(),
        SUBTITLE_LANGUAGES: "pt-BR,",
      }),
    /without empty entries/u,
  );
  assert.throws(
    () =>
      validateConfiguration({
        ...validEnvironment(),
        MINIMUM_SEEDERS: "-1",
      }),
    /non-negative integer/u,
  );
});

void test("optional credential pairs are visible and partial pairs fail", () => {
  const states = optionalCredentialStates(validEnvironment());
  assert.ok(states.every((state) => !state.configured && state.reason));
  assert.throws(
    () =>
      validateConfiguration({
        ...validEnvironment(),
        OPENSUBTITLESCOM_USER: "someone",
      }),
    /must either both be set or both be empty/u,
  );
});

void test("requires complete Cloudflare ACME configuration only in public TLS mode", () => {
  assert.doesNotThrow(() => validateConfiguration(validEnvironment()));
  assert.throws(
    () =>
      validateConfiguration({
        ...validEnvironment(),
        TRAEFIK_TLS_MODE: "unsupported",
      }),
    /TRAEFIK_TLS_MODE must be one of/u,
  );
  assert.throws(
    () =>
      validateConfiguration({
        ...validEnvironment(),
        TRAEFIK_DOMAIN: "localhost",
        TRAEFIK_TLS_MODE: "cloudflare-acme",
      }),
    /fully qualified lowercase domain/u,
  );

  const publicTls = {
    ...validEnvironment(),
    TRAEFIK_DOMAIN: "home.example.com",
    TRAEFIK_TLS_MODE: "cloudflare-acme",
    TRAEFIK_ACME_EMAIL: "operator@example.com",
    CF_DNS_API_TOKEN: "scoped-token",
  };
  assert.doesNotThrow(() => validateConfiguration(publicTls));
  assert.throws(
    () =>
      validateConfiguration({
        ...publicTls,
        TRAEFIK_ACME_EMAIL: "",
      }),
    /TRAEFIK_ACME_EMAIL/u,
  );
  assert.throws(
    () =>
      validateConfiguration({
        ...publicTls,
        CF_DNS_API_TOKEN: "",
      }),
    /CF_DNS_API_TOKEN/u,
  );
});
