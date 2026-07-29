import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  lanIpv4Cidr,
  ufwAllowLanArguments,
} from "../apphost/firewall.mjs";
import { publishedTraefikHttpsPort } from "../apphost/ingress.mjs";

const execute = promisify(execFile);
const outputDirectory = resolve(
  process.env.ARRSPIRE_OUTPUT_PATH ?? "aspire-output",
);
const compose = await readFile(
  resolve(outputDirectory, "docker-compose.yaml"),
  "utf8",
);
const httpsPort = publishedTraefikHttpsPort(compose);
const cidr =
  process.env.ARRSPIRE_LAN_CIDR ??
  lanIpv4Cidr((await execute("ip", ["-4", "route"])).stdout);

await execute("pkexec", [...ufwAllowLanArguments(cidr, httpsPort)]);
console.log(
  `Allowed Arrspire HTTPS on TCP ${String(httpsPort)} from ${cidr}.`,
);
