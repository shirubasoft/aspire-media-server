import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveArrspirePaths } from "../paths.mjs";
import {
  diskSpaceCheck,
  parseAspireParameters,
  supportedNodeVersion,
} from "../../scripts/doctor-support.mjs";
import {
  operatorConfig,
  setupParameters,
  type SetupValues,
  validateSetupValues,
} from "../../scripts/setup-support.mjs";

const values: SetupValues = {
  vpnProvider: "protonvpn",
  vpnCountries: "Netherlands",
  vpnWireguardKey: Buffer.alloc(32, 3).toString("base64"),
  timezone: "UTC",
  jellyfinLanguage: "en-US",
  subtitleLanguages: "en",
  traefikDomain: "192.168.1.10.nip.io",
  traefikTlsMode: "local",
  traefikAcmeEmail: "",
  cloudflareDnsApiToken: "",
  dataPath: "/srv/arrspire",
  mediaPath: "/srv/media",
  downloadsPath: "/srv/downloads",
  ntfyEndpoint: "https://ntfy.sh",
  ntfyTopic: "",
  ntfyToken: "",
};

void test("validates and materializes guided setup values", () => {
  assert.doesNotThrow(() => validateSetupValues(values));
  assert.deepEqual(operatorConfig(values), {
    schemaVersion: 1,
    paths: {
      data: "/srv/arrspire",
      media: "/srv/media",
      downloads: "/srv/downloads",
    },
  });
  assert.equal(
    setupParameters(values)["vpn-wireguard-key"],
    values.vpnWireguardKey,
  );
  assert.throws(
    () =>
      validateSetupValues({
        ...values,
        downloadsPath: "/srv/media/downloads",
      }),
    /must not overlap/u,
  );
});

void test("classifies runtime and capacity preflights", () => {
  assert.equal(supportedNodeVersion("v20.19.0"), true);
  assert.equal(supportedNodeVersion("v22.12.0"), false);
  assert.equal(supportedNodeVersion("v24.0.0"), true);
  assert.equal(diskSpaceCheck("disk", 12 * 1024 ** 3).status, "pass");
  assert.equal(diskSpaceCheck("disk", 5 * 1024 ** 3).status, "warn");
  assert.equal(diskSpaceCheck("disk", 1024 ** 3).status, "fail");
});

void test("reads only Aspire parameter secrets", () => {
  assert.deepEqual(
    parseAspireParameters({
      "Parameters:vpn-provider": "protonvpn",
      "ConnectionStrings:db": "secret",
      "Parameters:timezone": "UTC",
    }),
    {
      "vpn-provider": "protonvpn",
      timezone: "UTC",
    },
  );
});

void test("loads ignored operator path choices", async () => {
  const appHostDirectory = await mkdtemp(join(tmpdir(), "arrspire-config-"));
  const configDirectory = join(appHostDirectory, ".arrspire");
  await mkdir(configDirectory);
  await writeFile(
    join(configDirectory, "config.json"),
    JSON.stringify({
      schemaVersion: 1,
      paths: {
        data: "/opt/arrspire/data",
        media: "/opt/arrspire/media",
        downloads: "/opt/arrspire/downloads",
      },
    }),
  );

  const resolved = resolveArrspirePaths(appHostDirectory);
  assert.deepEqual(
    {
      data: resolved.data,
      media: resolved.media,
      downloads: resolved.downloads,
    },
    {
      data: "/opt/arrspire/data",
      media: "/opt/arrspire/media",
      downloads: "/opt/arrspire/downloads",
    },
  );
});
