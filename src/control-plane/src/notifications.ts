import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { readIfExists, writeIfChanged } from "./files.js";
import { log } from "./log.js";
import {
  classifyReadiness,
  compactReason,
  type Readiness,
  type ReconciliationResult,
} from "./readiness.js";

const notificationStatePath = "/data/status/notification-state.json";
const maximumRequestBytes = 256 * 1024;

export interface NtfyConfiguration {
  readonly endpoint: string;
  readonly topic: string;
  readonly token?: string;
  readonly click?: string;
}

interface NotificationState {
  readonly schemaVersion: 1;
  readonly status: Readiness;
  readonly fingerprint: string;
}

interface NtfyMessage {
  readonly title: string;
  readonly message: string;
  readonly priority: 3 | 4 | 5;
  readonly tags: readonly string[];
}

export function ntfyConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): NtfyConfiguration | undefined {
  const topic = environment.NTFY_TOPIC?.trim() ?? "";
  if (!topic) {
    return undefined;
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(topic)) {
    throw new Error(
      "NTFY_TOPIC must be 1-64 letters, numbers, underscores, or hyphens",
    );
  }
  const endpoint = environment.NTFY_ENDPOINT?.trim() || "https://ntfy.sh";
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("NTFY_ENDPOINT must be an HTTP or HTTPS URL");
  }
  const token = environment.NTFY_TOKEN?.trim();
  const click = environment.ARRSPIRE_HOME_URL?.trim();
  return {
    endpoint: url.toString(),
    topic,
    ...(token ? { token } : {}),
    ...(click ? { click } : {}),
  };
}

async function publishNtfy(
  configuration: NtfyConfiguration,
  message: NtfyMessage,
): Promise<void> {
  const response = await fetch(configuration.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(configuration.token === undefined
        ? {}
        : { authorization: `Bearer ${configuration.token}` }),
    },
    body: JSON.stringify({
      topic: configuration.topic,
      title: message.title,
      message: message.message,
      priority: message.priority,
      tags: message.tags,
      ...(configuration.click === undefined
        ? {}
        : { click: configuration.click }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`ntfy returned HTTP ${String(response.status)}`);
  }
}

function reconciliationFingerprint(
  results: readonly ReconciliationResult[],
): string {
  const status = classifyReadiness(results);
  const failures = results
    .filter((result) => result.status === "failed")
    .map((result) => ({
      name: result.name,
      required: result.required,
      reason: compactReason(result.reason),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return createHash("sha256")
    .update(JSON.stringify({ status, failures }))
    .digest("hex");
}

async function readNotificationState(
  statePath: string,
): Promise<NotificationState | undefined> {
  const raw = await readIfExists(statePath);
  if (raw === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<NotificationState>;
    if (
      parsed.schemaVersion === 1 &&
      ["ready", "attention", "failed"].includes(parsed.status ?? "") &&
      typeof parsed.fingerprint === "string"
    ) {
      return parsed as NotificationState;
    }
  } catch {
    // A malformed state file should trigger a fresh notification decision.
  }
  return undefined;
}

async function writeNotificationState(
  state: NotificationState,
  statePath: string,
): Promise<void> {
  await writeIfChanged(
    statePath,
    `${JSON.stringify(state, undefined, 2)}\n`,
    0o600,
  );
}

function reconciliationMessage(
  status: Readiness,
  results: readonly ReconciliationResult[],
): NtfyMessage {
  if (status === "ready") {
    return {
      title: "Arrspire recovered",
      message: "All required services and configured integrations are operational.",
      priority: 3,
      tags: ["white_check_mark", "movie_camera"],
    };
  }
  const failures = results
    .filter((result) => result.status === "failed")
    .map(
      (result) =>
        `${result.name}: ${compactReason(result.reason)}`,
    )
    .join("\n");
  return {
    title:
      status === "failed"
        ? "Arrspire reconciliation failed"
        : "Arrspire needs attention",
    message: failures || "One or more integrations need attention.",
    priority: status === "failed" ? 5 : 4,
    tags:
      status === "failed"
        ? ["rotating_light", "movie_camera"]
        : ["warning", "movie_camera"],
  };
}

export async function notifyReconciliation(
  results: readonly ReconciliationResult[],
  configuration = ntfyConfiguration(),
  statePath = notificationStatePath,
): Promise<{ readonly configured: boolean; readonly sent: boolean }> {
  if (configuration === undefined) {
    return { configured: false, sent: false };
  }
  const status = classifyReadiness(results);
  const fingerprint = reconciliationFingerprint(results);
  const currentState: NotificationState = {
    schemaVersion: 1,
    status,
    fingerprint,
  };
  const previous = await readNotificationState(statePath);
  const recovered =
    status === "ready" &&
    previous !== undefined &&
    previous.status !== "ready";
  const degraded =
    status !== "ready" && previous?.fingerprint !== fingerprint;
  if (recovered || degraded) {
    await publishNtfy(
      configuration,
      reconciliationMessage(status, results),
    );
    await writeNotificationState(currentState, statePath);
    return { configured: true, sent: true };
  }
  await writeNotificationState(currentState, statePath);
  return { configured: true, sent: false };
}

function stringField(
  value: Readonly<Record<string, unknown>>,
  name: string,
  fallback: string,
): string {
  return typeof value[name] === "string" && value[name]
    ? value[name]
    : fallback;
}

async function notifyDiun(
  payload: Readonly<Record<string, unknown>>,
  configuration = ntfyConfiguration(),
): Promise<{ readonly configured: boolean; readonly sent: boolean }> {
  if (configuration === undefined) {
    return { configured: false, sent: false };
  }
  const image = stringField(payload, "image", "A container image");
  const status = stringField(payload, "status", "updated");
  await publishNtfy(configuration, {
    title: `${image} has an update`,
    message: `${image} was reported as ${status} by DIUN.`,
    priority: 3,
    tags: ["package", "whale"],
  });
  return { configured: true, sent: true };
}

async function readJson(
  request: IncomingMessage,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumRequestBytes) {
      throw new Error("Request body exceeds 256 KiB");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(value)}\n`);
}

function reconciliationResults(value: unknown): readonly ReconciliationResult[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { results?: unknown }).results)
  ) {
    throw new Error("Expected a reconciliation results array");
  }
  const results = (value as { results: unknown[] }).results;
  if (
    results.some(
      (result) =>
        typeof result !== "object" ||
        result === null ||
        typeof (result as ReconciliationResult).name !== "string" ||
        typeof (result as ReconciliationResult).required !== "boolean" ||
        !["ready", "skipped", "failed"].includes(
          (result as ReconciliationResult).status,
        ),
    )
  ) {
    throw new Error("Received an invalid reconciliation result");
  }
  return results as readonly ReconciliationResult[];
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { status: "ready" });
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 404, { error: "Not found" });
    return;
  }
  const payload = await readJson(request);
  if (request.url === "/diun") {
    if (typeof payload !== "object" || payload === null) {
      throw new Error("Expected a DIUN event object");
    }
    sendJson(
      response,
      200,
      await notifyDiun(payload as Readonly<Record<string, unknown>>),
    );
    return;
  }
  if (request.url === "/reconciliation") {
    sendJson(
      response,
      200,
      await notifyReconciliation(reconciliationResults(payload)),
    );
    return;
  }
  sendJson(response, 404, { error: "Not found" });
}

export async function serveNotifications(): Promise<void> {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);
  const configured = ntfyConfiguration() !== undefined;
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      log.error("Notification request failed", {
        path: request.url,
        error: error instanceof Error ? error.message : String(error),
      });
      sendJson(response, 502, { error: "Notification delivery failed" });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      log.info("Notification relay listening", {
        port,
        configured,
      });
      resolve();
    });
  });
  await new Promise<void>((resolve) => {
    const close = (): void => {
      server.close(() => resolve());
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  });
}
