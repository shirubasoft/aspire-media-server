import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveIngressPorts } from "../apphost/ingress.mjs";
import { resolveArrspirePaths } from "../apphost/paths.mjs";

const composePath = resolve(
  process.env.ARRSPIRE_OUTPUT_PATH ?? "aspire-output",
  "docker-compose.yaml",
);
const compose = await readFile(composePath, "utf8");
const lines = compose.split(/\r?\n/u);
let service = "";
let inPorts = false;
const publishedPorts = new Map<string, string[]>();

for (const line of lines) {
  const serviceMatch = /^  ([a-z0-9][a-z0-9-]*):$/u.exec(line);
  if (serviceMatch?.[1] !== undefined) {
    service = serviceMatch[1];
    inPorts = false;
    continue;
  }
  if (/^    ports:$/u.test(line)) {
    inPorts = true;
    publishedPorts.set(service, []);
    continue;
  }
  if (inPorts) {
    const port = /^      - "([^"]+)"$/u.exec(line)?.[1];
    if (port !== undefined) {
      publishedPorts.get(service)?.push(port);
      continue;
    }
    if (/^    \S/u.test(line) || /^  \S/u.test(line)) {
      inPorts = false;
    }
  }
}

assert.deepEqual(
  [...publishedPorts.keys()],
  ["traefik"],
  "Only Traefik may publish host ports by default",
);
const ingressPorts = resolveIngressPorts(
  resolveArrspirePaths(process.cwd()).rootlessPodman,
);
assert.deepEqual(
  publishedPorts.get("traefik"),
  [`${String(ingressPorts.http)}:80`, `${String(ingressPorts.https)}:443`],
  "Traefik must publish the expected HTTP and HTTPS ingress ports",
);
assert.match(compose, /TRAEFIK_API_INSECURE: "false"/u);
assert.doesNotMatch(compose, /TRAEFIK_API_INSECURE: "true"/u);
assert.match(
  compose,
  /arrspire-dashboard:[\s\S]*?ASPIRE_DASHBOARD_FORWARDEDHEADERS_ENABLED: "true"/u,
  "Aspire dashboard must honor the public Traefik host and scheme",
);
assert.match(
  compose,
  /arrspire-dashboard:[\s\S]*?DOTNET_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS: "true"/u,
  "Traefik authentication must replace the dashboard's internal token login",
);
assert.match(
  compose,
  /duplicati:[\s\S]*?DUPLICATI__WEBSERVICE_ALLOWED_HOSTNAMES: "\*"/u,
  "Duplicati must accept its authenticated ingress hostname",
);
assert.match(
  compose,
  /homepage:[\s\S]*?HOMEPAGE_ALLOWED_HOSTS: "\$\{TRAEFIK_DOMAIN\},home\.\$\{TRAEFIK_DOMAIN\},/u,
  "Homepage must restrict requests to the generated ingress hostnames",
);
assert.match(
  compose,
  /homepage:[\s\S]*?target: "\/app\/config"[\s\S]*?read_only: true/u,
  "Homepage must mount its generated configuration read-only",
);
assert.match(
  compose,
  /traefik:[\s\S]*?CF_DNS_API_TOKEN: "\$\{CLOUDFLARE_DNS_API_TOKEN\}"/u,
  "Traefik must receive the Cloudflare token through a Compose environment placeholder",
);
assert.match(
  compose,
  /TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_STORAGE: "\/acme\/acme\.json"/u,
  "Traefik must persist ACME account and certificate state",
);
assert.match(
  compose,
  /TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE: "true"/u,
  "Traefik must activate the DNS-01 challenge in static configuration",
);
assert.match(
  compose,
  /TRAEFIK_CERTIFICATESRESOLVERS_LETSENCRYPT_ACME_DNSCHALLENGE_RESOLVERS: "1\.1\.1\.1:53,8\.8\.8\.8:53"/u,
  "Traefik must verify DNS-01 propagation through public resolvers",
);

for (const match of compose.matchAll(/^\s+image: "([^"]+)"$/gmu)) {
  const image = match[1] ?? "";
  if (image.startsWith("${")) {
    continue;
  }
  assert.match(
    image,
    /@sha256:[a-f0-9]{64}$/u,
    `Published image is not immutable: ${image}`,
  );
}
console.log("Validated immutable publication and ingress-only host exposure");
