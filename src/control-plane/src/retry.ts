import { setTimeout as delay } from "node:timers/promises";

export interface RetryOptions {
  readonly attempts: number;
  readonly initialDelayMs: number;
  readonly maximumDelayMs: number;
  readonly onRetry?: (
    error: unknown,
    attempt: number,
    delayMs: number,
  ) => void;
  readonly wait?: (delayMs: number) => Promise<void>;
}

export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  if (!Number.isSafeInteger(options.attempts) || options.attempts < 1) {
    throw new Error("Retry attempts must be a positive integer");
  }

  let nextDelayMs = options.initialDelayMs;
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === options.attempts) {
        throw error;
      }
      const delayMs = Math.min(nextDelayMs, options.maximumDelayMs);
      options.onRetry?.(error, attempt, delayMs);
      await (options.wait ?? delay)(delayMs);
      nextDelayMs = Math.min(delayMs * 2, options.maximumDelayMs);
    }
  }

  throw new Error("Retry loop exited unexpectedly");
}
