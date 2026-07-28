import { setTimeout as delay } from "node:timers/promises";

import { log } from "./log.js";

export interface RequestOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: BodyInit;
  readonly expected?: readonly number[];
  readonly timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly responseBody: string,
  ) {
    super(
      `HTTP ${status} from ${url}: ${responseBody.slice(0, 240) || "<empty>"}`,
    );
  }
}

export async function request(
  url: string,
  options: RequestOptions = {},
): Promise<Response> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  };
  if (options.headers !== undefined) {
    init.headers = options.headers;
  }
  if (options.body !== undefined) {
    init.body = options.body;
  }
  const response = await fetch(url, init);
  const expected = options.expected ?? [200, 201, 202, 204];
  if (!expected.includes(response.status)) {
    throw new HttpError(response.status, url, await response.text());
  }
  return response;
}

export async function json<T>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await request(url, options);
  return (await response.json()) as T;
}

export async function waitForHttp(
  name: string,
  url: string,
  options: {
    readonly attempts?: number;
    readonly intervalMs?: number;
    readonly expected?: readonly number[];
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): Promise<void> {
  const attempts = options.attempts ?? 90;
  const intervalMs = options.intervalMs ?? 2_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const requestOptions: RequestOptions = {
        ...(options.headers === undefined ? {} : { headers: options.headers }),
        expected: options.expected ?? [200, 204, 401, 403],
        timeoutMs: 5_000,
      };
      await request(url, requestOptions);
      log.info("Service is ready", { service: name, attempt });
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 1 || attempt % 10 === 0) {
        log.info("Waiting for service", { service: name, attempt });
      }
      await delay(intervalMs);
    }
  }

  throw new Error(
    `${name} did not become ready at ${url}: ${String(lastError)}`,
  );
}

export function form(values: Readonly<Record<string, string>>): URLSearchParams {
  return new URLSearchParams(Object.entries(values));
}
