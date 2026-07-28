import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
assert.deepEqual(
  publishedPorts.get("traefik"),
  ["80:80", "443:443"],
  "Traefik must be the HTTPS ingress on ports 80 and 443",
);
assert.match(compose, /--api\.insecure=false/u);
assert.doesNotMatch(compose, /--api\.insecure=true/u);

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
