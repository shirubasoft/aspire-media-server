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
    TRAEFIK_DOMAIN: "localhost",
    INGRESS_ADMIN_USER: "admin",
    INGRESS_ADMIN_PASSWORD: "not-logged-anywhere",
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
