import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { defaultTraefikDomain } from "../ingress.mjs";
import { generateLocalTls } from "../local-tls.mjs";

const execute = promisify(execFile);

void test(
  "generates a trusted wildcard certificate for browser-facing services",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "arrspire-local-tls-"));
    try {
      const assets = await generateLocalTls(root, defaultTraefikDomain);
      await execute("openssl", [
        "verify",
        "-CAfile",
        assets.caCertificate,
        assets.certificate,
      ]);
      const { stdout } = await execute("openssl", [
        "x509",
        "-in",
        assets.certificate,
        "-noout",
        "-checkhost",
        `jellyfin.${defaultTraefikDomain}`,
      ]);
      assert.match(stdout, /does match certificate/u);
      assert.match(
        await readFile(assets.traefikConfiguration, "utf8"),
        /defaultCertificate:[\s\S]*arrspire-local\.crt[\s\S]*arrspire-local\.key/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
