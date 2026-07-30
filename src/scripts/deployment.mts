import { spawn } from "node:child_process";
import { access, chmod, readFile } from "node:fs/promises";
import { request } from "node:https";
import { resolve } from "node:path";

import { selectComposeProjectName } from "../apphost/compose-project.mjs";
import {
  defaultTraefikDomain,
  httpsServiceUrl,
  publishedTraefikHttpsPort,
} from "../apphost/ingress.mjs";
import {
  authenticationDescription,
  credentialSources,
  serviceSurfaces,
} from "../control-plane/src/service-surfaces.js";
import {
  classifyResult,
  compactReason,
  type ReconciliationResult,
  type ResultCategory,
} from "../control-plane/src/readiness.js";
import {
  cloudflareZoneForDomain,
  type CloudflareDnsRecord,
  type CloudflareZone,
  homepageDnsPlan,
  isPodmanNetworkDependencyFailure,
  parameterEnvironment,
  podmanRecoveryPlan,
} from "./deployment-support.mjs";

type Action = "deploy" | "down" | "publish" | "repair" | "status";
type Engine = "docker" | "podman";

const action = (process.argv[2] ?? "deploy") as Action;
if (!["deploy", "down", "publish", "repair", "status"].includes(action)) {
  throw new Error(`Unknown deployment action: ${action}`);
}

const outputDirectory = resolve(
  process.env.ARRSPIRE_OUTPUT_PATH ?? "aspire-output",
);
const composeFile = resolve(outputDirectory, "docker-compose.yaml");
const environment = process.env.ARRSPIRE_ENVIRONMENT ?? "Production";
const publishEnvironmentFile = resolve(outputDirectory, ".env");
const deploymentEnvironmentFile = resolve(
  outputDirectory,
  `.env.${environment}`,
);
const cloudflareApi = "https://api.cloudflare.com/client/v4";

// Aspire deployment artifacts can contain resolved secrets. Keep all files
// created by this process private even before their final permissions are set.
process.umask(0o077);

async function run(
  command: string,
  args: readonly string[],
  quiet = false,
  environmentOverrides: Readonly<NodeJS.ProcessEnv> = {},
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...environmentOverrides },
      stdio: quiet ? "ignore" : "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${command} exited with ${String(code)}${signal ? ` (${signal})` : ""}`,
        ),
      );
    });
  });
}

class CommandExecutionError extends Error {
  public constructor(
    message: string,
    public readonly output: string,
  ) {
    super(message);
  }
}

async function runStreaming(
  command: string,
  args: readonly string[],
  environmentOverrides: Readonly<NodeJS.ProcessEnv> = {},
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...environmentOverrides },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      process.stderr.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new CommandExecutionError(
          `${command} exited with ${String(code)}${signal ? ` (${signal})` : ""}`,
          Buffer.concat(chunks).toString("utf8").slice(-131_072),
        ),
      );
    });
  });
}

async function output(
  command: string,
  args: readonly string[],
): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(chunks).toString("utf8"));
        return;
      }
      reject(
        new Error(
          `${command} exited with ${String(code)}${signal ? ` (${signal})` : ""}`,
        ),
      );
    });
  });
}

async function parameterSecretEnvironment(): Promise<NodeJS.ProcessEnv> {
  let values: unknown;
  try {
    values = JSON.parse(
      await output("aspire", [
        "secret",
        "list",
        "--format",
        "Json",
        "--non-interactive",
        "--nologo",
      ]),
    ) as unknown;
  } catch {
    return {};
  }
  return parameterEnvironment(values, process.env);
}

async function composeProjectName(
  engine: Engine,
): Promise<string | undefined> {
  return selectComposeProjectName(
    await output(engine, ["compose", "ls", "--format", "json"]),
    composeFile,
  );
}

async function composeArguments(
  engine: Engine,
  command: readonly string[],
): Promise<readonly string[]> {
  let projectName: string | undefined;
  try {
    projectName = await composeProjectName(engine);
  } catch {
    // Before the first deployment, Compose has no matching project yet.
  }
  return [
    "compose",
    ...(projectName === undefined
      ? []
      : ["--project-name", projectName]),
    "--env-file",
    deploymentEnvironmentFile,
    "--file",
    composeFile,
    ...command,
  ];
}

async function available(engine: Engine): Promise<boolean> {
  try {
    await run(engine, ["info"], true);
    await run(engine, ["compose", "version"], true);
    return true;
  } catch {
    return false;
  }
}

async function containerEngine(): Promise<Engine> {
  const configured = process.env.ARRSPIRE_CONTAINER_ENGINE;
  if (configured === "docker" || configured === "podman") {
    return configured;
  }
  if (await available("docker")) {
    return "docker";
  }
  if (await available("podman")) {
    return "podman";
  }
  throw new Error(
    "Neither Docker Compose nor Podman Compose is available. Set ARRSPIRE_CONTAINER_ENGINE after installing one.",
  );
}

async function publish(): Promise<void> {
  await run(
    "aspire",
    [
      "publish",
      "--output-path",
      outputDirectory,
      "--environment",
      environment,
      "--non-interactive",
    ],
    false,
    await parameterSecretEnvironment(),
  );
  await chmod(publishEnvironmentFile, 0o600);
}

async function deploy(engine: Engine): Promise<void> {
  const secretEnvironment = await parameterSecretEnvironment();
  const deployArguments = [
    "deploy",
    "--output-path",
    outputDirectory,
    "--environment",
    environment,
    "--non-interactive",
  ];
  try {
    await runStreaming("aspire", deployArguments, {
      ...secretEnvironment,
      ASPIRE_CONTAINER_RUNTIME: engine,
    });
  } catch (error) {
    if (
      engine !== "podman" ||
      !(error instanceof CommandExecutionError) ||
      !isPodmanNetworkDependencyFailure(error.output)
    ) {
      throw error;
    }
    await recoverPodmanDeployment();
  }
  await chmod(deploymentEnvironmentFile, 0o600);
  const homepageAddress = await reconcileHomepageDns();
  await verifyHomepage(homepageAddress);
}

async function recoverPodmanDeployment(): Promise<void> {
  const projectName = await composeProjectName("podman");
  if (projectName === undefined) {
    throw new Error(
      "Podman reported the Gluetun dependency conflict, but the existing Compose project could not be identified.",
    );
  }

  const document = JSON.parse(
    await output("podman", ["ps", "--all", "--format", "json"]),
  ) as unknown;
  const plan = podmanRecoveryPlan(document, projectName);
  if (plan === undefined) {
    throw new Error(
      "Podman reported the Gluetun dependency conflict, but no safe project-scoped recovery plan was found.",
    );
  }

  console.log(
    "\nPodman kept VPN-routed containers attached to the previous Gluetun namespace; recovering the generated Compose deployment.",
  );
  await run("podman", ["rm", "--force", ...plan.dependents]);
  if (plan.infrastructure.length > 0) {
    await run("podman", ["rm", "--force", ...plan.infrastructure]);
  }
  await run(
    "podman",
    await composeArguments("podman", [
      "up",
      "--detach",
      "--remove-orphans",
    ]),
  );
}

interface CloudflareEnvelope<T> {
  readonly success?: unknown;
  readonly result?: unknown;
  readonly errors?: unknown;
}

async function cloudflareRequest<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${cloudflareApi}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const envelope = await response.json() as CloudflareEnvelope<T>;
  if (!response.ok || envelope.success !== true) {
    throw new Error(
      `Cloudflare API request failed with HTTP ${String(response.status)}.`,
    );
  }
  return envelope.result as T;
}

async function reconcileHomepageDns(): Promise<string | undefined> {
  const values = await environmentValues();
  if (values.TRAEFIK_TLS_MODE !== "cloudflare-acme") {
    return undefined;
  }

  const domain = values.TRAEFIK_DOMAIN;
  const token = values.CLOUDFLARE_DNS_API_TOKEN;
  if (!domain || !token) {
    throw new Error(
      "Cloudflare ACME deployment is missing TRAEFIK_DOMAIN or CLOUDFLARE_DNS_API_TOKEN.",
    );
  }

  console.log(`\nReconciling the bare Homepage DNS record for ${domain}.`);
  const zones = await cloudflareRequest<readonly CloudflareZone[]>(
    token,
    "/zones?per_page=50",
  );
  const zone = cloudflareZoneForDomain(zones, domain);
  if (zone === undefined) {
    throw new Error(`No token-accessible Cloudflare zone owns ${domain}.`);
  }

  const [exact, wildcard] = await Promise.all([
    cloudflareRequest<readonly CloudflareDnsRecord[]>(
      token,
      `/zones/${zone.id}/dns_records?name=${encodeURIComponent(domain)}&per_page=100`,
    ),
    cloudflareRequest<readonly CloudflareDnsRecord[]>(
      token,
      `/zones/${zone.id}/dns_records?name=${encodeURIComponent(`*.${domain}`)}&per_page=100`,
    ),
  ]);
  const plan = homepageDnsPlan([...exact, ...wildcard], domain);
  if (plan === undefined) {
    throw new Error(
      `Create a DNS-only A/AAAA record for ${domain}, or a scoped *.${domain} record that the deployment can copy.`,
    );
  }
  if (plan.action === "reuse") {
    console.log(`Homepage DNS is already configured for ${domain}.`);
    return plan.record.content;
  }

  const created = await cloudflareRequest<CloudflareDnsRecord>(
    token,
    `/zones/${zone.id}/dns_records`,
    {
      method: "POST",
      body: JSON.stringify({
        type: plan.record.type,
        name: plan.record.name,
        content: plan.record.content,
        ttl: plan.record.ttl ?? 1,
        proxied: false,
        comment: "Managed by the Arrspire deployment pipeline",
      }),
    },
  );
  console.log(`Created the DNS-only Homepage record for ${domain}.`);
  return created.content;
}

async function homepageStatus(
  domain: string,
  port: number,
  address: string | undefined,
  authorization: string | undefined,
  rejectUnauthorized: boolean,
): Promise<number> {
  return await new Promise<number>((resolvePromise, reject) => {
    const homepageRequest = request(
      {
        hostname: address ?? domain,
        port,
        path: "/",
        method: "GET",
        servername: domain,
        rejectUnauthorized,
        headers: {
          Host: port === 443 ? domain : `${domain}:${String(port)}`,
          ...(authorization === undefined ? {} : { Authorization: authorization }),
        },
      },
      (response) => {
        response.resume();
        response.once("end", () =>
          resolvePromise(response.statusCode ?? 0)
        );
      },
    );
    homepageRequest.setTimeout(5_000, () => {
      homepageRequest.destroy(new Error("Homepage request timed out."));
    });
    homepageRequest.once("error", reject);
    homepageRequest.end();
  });
}

async function verifyHomepage(address: string | undefined): Promise<void> {
  const values = await environmentValues();
  if (values.TRAEFIK_TLS_MODE !== "cloudflare-acme") {
    return;
  }
  const domain = values.TRAEFIK_DOMAIN;
  const user = values.INGRESS_ADMIN_USER;
  const password = values.INGRESS_ADMIN_PASSWORD;
  if (!domain || !user || !password) {
    throw new Error(
      "Homepage verification requires the deployed domain and ingress credentials.",
    );
  }
  const port = publishedTraefikHttpsPort(
    await readFile(composeFile, "utf8"),
  );
  const configuredTimeout = Number.parseInt(
    process.env.ARRSPIRE_DEPLOY_VERIFY_TIMEOUT_MS ?? "180000",
    10,
  );
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 180_000;
  const deadline = Date.now() + timeout;
  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  let lastFailure = "the endpoint did not become ready";

  console.log(
    `Waiting for a trusted certificate and authenticated Homepage at https://${domain}:${String(port)}/.`,
  );
  while (Date.now() < deadline) {
    try {
      // The first request starts Traefik's on-demand certificate flow.
      await homepageStatus(domain, port, address, undefined, false);
    } catch {
      // The strict checks below provide the actionable final failure.
    }
    try {
      const unauthenticated = await homepageStatus(
        domain,
        port,
        address,
        undefined,
        true,
      );
      const authenticated = await homepageStatus(
        domain,
        port,
        address,
        authorization,
        true,
      );
      if (unauthenticated === 401 && authenticated === 200) {
        console.log(
          `Homepage is ready with trusted TLS and ingress authentication: https://${domain}:${String(port)}/`,
        );
        return;
      }
      lastFailure =
        `expected HTTP 401/200 but received ${String(unauthenticated)}/${String(authenticated)}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  throw new Error(
    `Homepage verification timed out after ${String(timeout)} ms: ${lastFailure}`,
  );
}

async function down(engine: Engine): Promise<void> {
  try {
    await Promise.all([
      access(composeFile),
      access(deploymentEnvironmentFile),
    ]);
  } catch {
    throw new Error(
      `No prepared ${environment} deployment exists in ${outputDirectory}. Run npm run deploy first.`,
    );
  }
  await run(
    engine,
    await composeArguments(engine, ["down", "--remove-orphans"]),
  );
}

async function environmentValues(): Promise<
  Readonly<Record<string, string>>
> {
  try {
    const content = await readFile(deploymentEnvironmentFile, "utf8");
    return Object.fromEntries(
      content
        .split(/\r?\n/u)
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const separator = line.indexOf("=");
          const name = line.slice(0, separator);
          const raw = line.slice(separator + 1);
          const value =
            raw.startsWith('"') && raw.endsWith('"')
              ? raw.slice(1, -1).replaceAll('\\"', '"')
              : raw;
          return [name, value];
        }),
    );
  } catch {
    return {};
  }
}

async function readStatusFile(
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

function reconciliationResults(
  value: unknown,
): readonly ReconciliationResult[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (result): result is ReconciliationResult =>
      typeof result === "object" &&
      result !== null &&
      typeof (result as { name?: unknown }).name === "string" &&
      typeof (result as { required?: unknown }).required === "boolean" &&
      ["ready", "skipped", "failed"].includes(
        String((result as { status?: unknown }).status),
      ),
  );
}

function printResultSection(
  title: string,
  category: ResultCategory,
  results: readonly ReconciliationResult[],
): void {
  const matches = results.filter(
    (result) => classifyResult(result) === category,
  );
  if (matches.length === 0) {
    return;
  }
  console.log(title);
  console.table(
    matches.map((result) => ({
      integration: result.name,
      reason: compactReason(result.reason),
    })),
  );
}

async function printStatus(engine?: Engine): Promise<void> {
  const values = await environmentValues();
  let httpsPort = 443;
  try {
    httpsPort = publishedTraefikHttpsPort(
      await readFile(composeFile, "utf8"),
    );
  } catch {
    // The conventional HTTPS port is still the useful pre-publication default.
  }
  const domain =
    values.TRAEFIK_DOMAIN ??
    process.env.Parameters__traefik_domain ??
    defaultTraefikDomain;
  const dataPath =
    values.BOOTSTRAP_BINDMOUNT_0 ??
    process.env.ARRSPIRE_DATA_PATH ??
    resolve("..", "data");
  console.log("\nArrspire access (HTTPS)");
  console.table(
    serviceSurfaces.map((surface) => {
      return {
        service: surface.label,
        url: httpsServiceUrl(surface.name, domain, httpsPort),
        authentication: authenticationDescription(surface.authentication),
      };
    }),
  );
  console.log("Initial credential sources");
  console.table(credentialSources);

  const [bootstrap, reconciliation] = await Promise.all([
    readStatusFile(resolve(dataPath, "status", "bootstrap.json")),
    readStatusFile(resolve(dataPath, "status", "reconciliation.json")),
  ]);
  console.log("Readiness");
  console.table([
    {
      phase: "bootstrap",
      status: bootstrap?.status ?? "pending",
      updatedAt: bootstrap?.updatedAt ?? "-",
    },
    {
      phase: "reconciliation",
      status: reconciliation?.status ?? "pending",
      updatedAt: reconciliation?.updatedAt ?? "-",
    },
  ]);
  const results = reconciliationResults(reconciliation?.results);
  printResultSection(
    "Needs attention",
    "needs-attention",
    results,
  );
  printResultSection(
    "External services unavailable",
    "externally-unavailable",
    results,
  );
  printResultSection(
    "Optional integrations not configured",
    "not-configured",
    results,
  );

  if (engine !== undefined) {
    try {
      await Promise.all([
        access(composeFile),
        access(deploymentEnvironmentFile),
      ]);
      console.log("Container state");
      await run(engine, await composeArguments(engine, ["ps"]));
    } catch {
      console.log("No prepared deployment is available for container status.");
    }
  }
  console.log(
    "If readiness needs attention or has failed, correct the issue and run npm run repair.",
  );
}

async function repair(engine: Engine): Promise<void> {
  await Promise.all([
    access(composeFile),
    access(deploymentEnvironmentFile),
  ]);
  await run(
    engine,
    await composeArguments(engine, ["run", "--rm", "reconciler"]),
  );
  await printStatus(engine);
}

if (action === "publish") {
  await publish();
} else if (action === "status") {
  let engine: Engine | undefined;
  try {
    engine = await containerEngine();
  } catch {
    // File-based readiness remains useful without a running engine.
  }
  await printStatus(engine);
} else {
  const engine = await containerEngine();
  if (action === "deploy") {
    await deploy(engine);
    await printStatus(engine);
  } else if (action === "repair") {
    await repair(engine);
  } else {
    await down(engine);
  }
}
