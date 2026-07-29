import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { defaultTraefikDomain } from "../apphost/ingress.mjs";
import { generateLocalTls } from "../apphost/local-tls.mjs";

const execute = promisify(execFile);
const tlsMode =
  process.env.Parameters__traefik_tls_mode ?? "local";
if (tlsMode !== "local") {
  throw new Error(
    `Local CA generation is disabled when traefik-tls-mode is ${tlsMode}`,
  );
}
const domain =
  process.argv[2] ??
  process.env.Parameters__traefik_domain ??
  defaultTraefikDomain;
const dataPath = resolve(process.env.ARRSPIRE_DATA_PATH ?? "../data");
const assets = await generateLocalTls(dataPath, domain);
const nssDatabase = resolve(homedir(), ".pki", "nssdb");

await mkdir(nssDatabase, { recursive: true, mode: 0o700 });
try {
  await access(resolve(nssDatabase, "cert9.db"));
} catch {
  await execute("certutil", [
    "-N",
    "--empty-password",
    "-d",
    `sql:${nssDatabase}`,
  ]);
}
try {
  await execute("certutil", [
    "-D",
    "-d",
    `sql:${nssDatabase}`,
    "-n",
    "Arrspire Local CA",
  ]);
} catch {
  // The first setup has no prior Arrspire CA entry to remove.
}
await execute("certutil", [
  "-A",
  "-d",
  `sql:${nssDatabase}`,
  "-n",
  "Arrspire Local CA",
  "-t",
  "C,,",
  "-i",
  assets.caCertificate,
]);

console.log(`Configured Traefik local TLS for *.${domain}.`);
console.log(
  "Installed Arrspire Local CA in the current user's browser trust database.",
);
console.log("Restart open browsers once, then redeploy or reload Traefik.");
