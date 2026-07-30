import { spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { lookup } from "node:dns/promises";
import { access, constants, readFile, stat, statfs } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultTraefikDomain,
  resolveIngressPorts,
} from "../apphost/ingress.mjs";
import { validateArrspirePathLayout } from "../apphost/path-validation.mjs";
import {
  arrspireOperatorConfigPath,
  resolveArrspirePaths,
} from "../apphost/paths.mjs";
import { ntfyConfiguration } from "../control-plane/src/notifications.js";
import {
  validateConfiguration,
  validateWireguardKey,
} from "../control-plane/src/validation.js";
import {
  type DoctorCheck,
  diskSpaceCheck,
  parseAspireParameters,
  supportedNodeVersion,
} from "./doctor-support.mjs";

type Engine = "docker" | "podman";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checks: DoctorCheck[] = [];

async function output(
  command: string,
  args: readonly string[],
): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: sourceRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8").trim());
        return;
      }
      reject(
        new Error(
          Buffer.concat(stderr).toString("utf8").trim() ||
            `${command} exited with ${String(code)}`,
        ),
      );
    });
  });
}

async function succeeds(
  command: string,
  args: readonly string[],
): Promise<boolean> {
  try {
    await output(command, args);
    return true;
  } catch {
    return false;
  }
}

function parameter(
  parameters: Readonly<Record<string, string>>,
  name: string,
  fallback = "",
): string {
  return (
    process.env[`Parameters__${name.replaceAll("-", "_")}`] ??
    parameters[name] ??
    fallback
  );
}

async function aspireParameters(): Promise<Readonly<Record<string, string>>> {
  try {
    return parseAspireParameters(
      JSON.parse(
        await output("aspire", [
          "secret",
          "list",
          "--format",
          "Json",
          "--non-interactive",
          "--nologo",
        ]),
      ) as unknown,
    );
  } catch {
    return {};
  }
}

async function engineCheck(): Promise<Engine | undefined> {
  const configured = process.env.ARRSPIRE_CONTAINER_ENGINE;
  const candidates: readonly Engine[] =
    configured === "docker" || configured === "podman"
      ? [configured]
      : ["docker", "podman"];
  for (const engine of candidates) {
    if (
      (await succeeds(engine, ["info"])) &&
      (await succeeds(engine, ["compose", "version"]))
    ) {
      checks.push({
        name: "Container engine",
        status: "pass",
        detail: `${engine} and Compose are available`,
      });
      return engine;
    }
  }
  checks.push({
    name: "Container engine",
    status: "fail",
    detail: "No working Docker/Podman engine with Compose was found",
    fix: "Start Docker or Podman and install its Compose integration.",
  });
  return undefined;
}

async function checkDirectory(name: string, path: string): Promise<void> {
  try {
    const details = await stat(path);
    if (!details.isDirectory()) {
      checks.push({
        name,
        status: "fail",
        detail: `${path} is not a directory`,
        fix: "Choose a directory with npm run setup.",
      });
      return;
    }
    await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
    checks.push({ name, status: "pass", detail: `${path} is writable` });
    const filesystem = await statfs(path);
    checks.push(
      diskSpaceCheck(
        `${name} capacity`,
        Number(filesystem.bavail) * Number(filesystem.bsize),
      ),
    );
  } catch (error) {
    checks.push({
      name,
      status: "fail",
      detail: `${path}: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Run npm run setup or correct directory ownership and permissions.",
    });
  }
}

async function checkPort(name: string, port: number): Promise<void> {
  const result = await new Promise<DoctorCheck>((resolvePromise) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      resolvePromise({
        name,
        status: "warn",
        detail:
          error.code === "EADDRINUSE"
            ? `port ${String(port)} is already in use`
            : `cannot bind port ${String(port)}: ${error.message}`,
        fix:
          error.code === "EADDRINUSE"
            ? "This is expected when Arrspire is running; otherwise set an ARRSPIRE_INGRESS_*_PORT override."
            : "The container engine may still bind this port; otherwise choose an ARRSPIRE_INGRESS_*_PORT override.",
      });
    });
    server.listen(port, "0.0.0.0", () => {
      server.close(() =>
        resolvePromise({
          name,
          status: "pass",
          detail: `port ${String(port)} is available`,
        }),
      );
    });
  });
  checks.push(result);
}

async function checkDns(domain: string): Promise<void> {
  const names = [domain, `auth.${domain}`, `jellyfin.${domain}`];
  for (const hostname of names) {
    try {
      const address = await lookup(hostname);
      checks.push({
        name: `DNS ${hostname}`,
        status: "pass",
        detail: `resolves to ${address.address}`,
      });
    } catch {
      checks.push({
        name: `DNS ${hostname}`,
        status: "fail",
        detail: "hostname does not resolve",
        fix: "Create private DNS records or use the server-address.nip.io domain.",
      });
    }
  }
}

async function checkTls(
  mode: string,
  domain: string,
  dataPath: string,
  parameters: Readonly<Record<string, string>>,
): Promise<void> {
  if (mode === "cloudflare-acme") {
    const email = parameter(parameters, "traefik-acme-email");
    const token = parameter(parameters, "cloudflare-dns-api-token");
    checks.push({
      name: "Public TLS inputs",
      status: email && token ? "pass" : "fail",
      detail:
        email && token
          ? "ACME email and scoped Cloudflare token are configured"
          : "ACME email or Cloudflare token is missing",
      ...(!email || !token
        ? { fix: "Run npm run setup and complete the cloudflare-acme prompts." }
        : {}),
    });
    return;
  }
  const certificatePath = join(
    dataPath,
    "traefik",
    "dynamic",
    "certs",
    "arrspire-local.crt",
  );
  try {
    const certificate = new X509Certificate(await readFile(certificatePath));
    const remaining = new Date(certificate.validTo).getTime() - Date.now();
    const domainCovered =
      certificate.checkHost(domain) !== undefined &&
      certificate.checkHost(`auth.${domain}`) !== undefined &&
      certificate.checkHost(`jellyfin.${domain}`) !== undefined;
    checks.push({
      name: "Local TLS certificate",
      status:
        remaining > 30 * 24 * 60 * 60 * 1000 && domainCovered ? "pass" : "warn",
      detail: `valid until ${certificate.validTo}; domain coverage ${domainCovered ? "ok" : "missing"}`,
      ...(remaining <= 30 * 24 * 60 * 60 * 1000 || !domainCovered
        ? { fix: `Run npm run tls:local -- ${domain}` }
        : {}),
    });
  } catch {
    checks.push({
      name: "Local TLS certificate",
      status: "warn",
      detail: "no generated local certificate was found",
      fix: `Run npm run tls:local -- ${domain} before browser access.`,
    });
  }
}

async function checkStatus(dataPath: string): Promise<void> {
  for (const phase of ["bootstrap", "reconciliation"] as const) {
    try {
      const value = JSON.parse(
        await readFile(join(dataPath, "status", `${phase}.json`), "utf8"),
      ) as { status?: unknown; updatedAt?: unknown };
      const status = String(value.status ?? "unknown");
      checks.push({
        name: `${phase} status`,
        status:
          status === "ready"
            ? "pass"
            : status === "attention"
              ? "warn"
              : "fail",
        detail: `${status} (${String(value.updatedAt ?? "unknown time")})`,
        ...(status === "ready"
          ? {}
          : {
              fix: "Inspect npm run status, correct the issue, then run npm run repair.",
            }),
      });
    } catch {
      checks.push({
        name: `${phase} status`,
        status: "warn",
        detail: "not available yet",
        fix: "Run npm run dev or npm run deploy after setup.",
      });
    }
  }
}

checks.push({
  name: "Node.js",
  status: supportedNodeVersion(process.version) ? "pass" : "fail",
  detail: process.version,
  ...(!supportedNodeVersion(process.version)
    ? {
        fix: "Install Node.js 22.13+ (or another version allowed by package.json).",
      }
    : {}),
});

try {
  const version = await output("aspire", ["--version"]);
  checks.push({
    name: "Aspire CLI",
    status: version.startsWith("13.4.") ? "pass" : "warn",
    detail: version,
    ...(!version.startsWith("13.4.")
      ? {
          fix: "Use the current stable Aspire CLI; this project is validated with 13.4.x.",
        }
      : {}),
  });
} catch {
  checks.push({
    name: "Aspire CLI",
    status: "fail",
    detail: "aspire command not found",
    fix: "Install the current stable Aspire CLI.",
  });
}

await engineCheck();
const parameters = await aspireParameters();
const vpnKey = parameter(parameters, "vpn-wireguard-key");
let vpnKeyValid = false;
try {
  validateWireguardKey(vpnKey);
  vpnKeyValid = true;
  checks.push({
    name: "VPN WireGuard key",
    status: "pass",
    detail: "configured and structurally valid",
  });
} catch (error) {
  checks.push({
    name: "VPN WireGuard key",
    status: "fail",
    detail: error instanceof Error ? error.message : String(error),
    fix: "Run npm run setup with the private key from your VPN provider.",
  });
}
try {
  validateConfiguration({
    VPN_PROVIDER: parameter(parameters, "vpn-provider", "protonvpn"),
    VPN_COUNTRIES: parameter(parameters, "vpn-countries", "Netherlands"),
    VPN_WIREGUARD_KEY: vpnKeyValid
      ? vpnKey
      : Buffer.alloc(32, 1).toString("base64"),
    TIMEZONE: parameter(parameters, "timezone", "America/Sao_Paulo"),
    JELLYFIN_LANGUAGE: parameter(parameters, "jellyfin-language", "pt-BR"),
    SUBTITLE_LANGUAGES: parameter(parameters, "subtitle-languages", "pt-BR"),
    MINIMUM_SEEDERS: parameter(parameters, "minimum-seeders", "1"),
    USE_ORIGINAL_TITLE: parameter(parameters, "use-original-title", "false"),
    TRAEFIK_DOMAIN: parameter(
      parameters,
      "traefik-domain",
      defaultTraefikDomain,
    ),
    TRAEFIK_TLS_MODE: parameter(parameters, "traefik-tls-mode", "local"),
    TRAEFIK_ACME_EMAIL: parameter(parameters, "traefik-acme-email"),
    CF_DNS_API_TOKEN: parameter(parameters, "cloudflare-dns-api-token"),
    INGRESS_ADMIN_USER: parameter(parameters, "ingress-admin-user", "admin"),
    INGRESS_ADMIN_PASSWORD: "generated-by-aspire",
    AUTHELIA_SESSION_SECRET: "s".repeat(64),
    AUTHELIA_STORAGE_ENCRYPTION_KEY: "e".repeat(64),
    OPENSUBTITLESCOM_USER: parameter(parameters, "opensubtitlescom-user"),
    OPENSUBTITLESCOM_PASSWORD: parameter(
      parameters,
      "opensubtitlescom-password",
    ),
    OPENSUBTITLESORG_USER: parameter(parameters, "opensubtitlesorg-user"),
    OPENSUBTITLESORG_PASSWORD: parameter(
      parameters,
      "opensubtitlesorg-password",
    ),
    LEGENDASDIVX_USER: parameter(parameters, "legendasdivx-user"),
    LEGENDASDIVX_PASSWORD: parameter(parameters, "legendasdivx-password"),
    LEGENDASNET_USER: parameter(parameters, "legendasnet-user"),
    LEGENDASNET_PASSWORD: parameter(parameters, "legendasnet-password"),
  });
  checks.push({
    name: "Deployment parameters",
    status: "pass",
    detail: "provider, locale, ingress, and optional pairs are valid",
  });
} catch (error) {
  checks.push({
    name: "Deployment parameters",
    status: "fail",
    detail: error instanceof Error ? error.message : String(error),
    fix: "Run npm run setup and correct the reported value.",
  });
}

let paths: ReturnType<typeof resolveArrspirePaths> | undefined;
try {
  paths = resolveArrspirePaths(sourceRoot);
  validateArrspirePathLayout(paths);
  const configPath = arrspireOperatorConfigPath(sourceRoot);
  try {
    await access(configPath, constants.R_OK);
    checks.push({
      name: "Operator config",
      status: "pass",
      detail: configPath,
    });
  } catch {
    checks.push({
      name: "Operator config",
      status: "warn",
      detail: "using default or environment-provided paths",
      fix: "Run npm run setup to persist local path choices.",
    });
  }
  await Promise.all([
    checkDirectory("Data directory", paths.data),
    checkDirectory("Media directory", paths.media),
    checkDirectory("Downloads directory", paths.downloads),
  ]);
  try {
    const socket = await stat(paths.containerSocket);
    checks.push({
      name: "Container socket",
      status: socket.isSocket() ? "pass" : "warn",
      detail: paths.containerSocket,
      ...(!socket.isSocket()
        ? { fix: "Set ARRSPIRE_CONTAINER_SOCKET to the engine's Unix socket." }
        : {}),
    });
  } catch {
    checks.push({
      name: "Container socket",
      status: "fail",
      detail: `${paths.containerSocket} is unavailable`,
      fix: "Start the container engine or set ARRSPIRE_CONTAINER_SOCKET.",
    });
  }
  const ports = resolveIngressPorts(paths.rootlessPodman);
  await Promise.all([
    checkPort("HTTP ingress", ports.http),
    checkPort("HTTPS ingress", ports.https),
  ]);
} catch (error) {
  checks.push({
    name: "Operator config",
    status: "fail",
    detail: error instanceof Error ? error.message : String(error),
    fix: "Run npm run setup and choose three non-overlapping absolute paths.",
  });
}

const domain = parameter(parameters, "traefik-domain", defaultTraefikDomain);
const tlsMode = parameter(parameters, "traefik-tls-mode", "local");
await checkDns(domain);
if (paths !== undefined) {
  await checkTls(tlsMode, domain, paths.data, parameters);
  await checkStatus(paths.data);
}

try {
  const configured =
    ntfyConfiguration({
      NTFY_ENDPOINT: parameter(parameters, "ntfy-endpoint", "https://ntfy.sh"),
      NTFY_TOPIC: parameter(parameters, "ntfy-topic"),
      NTFY_TOKEN: parameter(parameters, "ntfy-token"),
    }) !== undefined;
  checks.push({
    name: "Push notifications",
    status: "pass",
    detail: configured ? "configured" : "not configured (optional)",
  });
} catch (error) {
  checks.push({
    name: "Push notifications",
    status: "fail",
    detail: error instanceof Error ? error.message : String(error),
    fix: "Run npm run setup and correct the ntfy endpoint/topic.",
  });
}

console.log("Arrspire doctor\n");
for (const check of checks) {
  const marker =
    check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗";
  console.log(`${marker} ${check.name}: ${check.detail}`);
  if (check.fix !== undefined) {
    console.log(`  ${check.fix}`);
  }
}
const totals = {
  passed: checks.filter((check) => check.status === "pass").length,
  warnings: checks.filter((check) => check.status === "warn").length,
  failures: checks.filter((check) => check.status === "fail").length,
};
console.log(
  `\n${String(totals.passed)} passed, ${String(totals.warnings)} warnings, ${String(totals.failures)} failures`,
);
if (totals.failures > 0) {
  process.exitCode = 1;
}
