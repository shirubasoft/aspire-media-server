import { verifyAcceptance } from "./acceptance.js";
import { bootstrap } from "./bootstrap.js";
import { log } from "./log.js";
import { reconcile } from "./reconcile.js";
import { retry } from "./retry.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "bootstrap") {
    await bootstrap();
    return;
  }
  if (command === "reconcile") {
    await retry(reconcile, {
      attempts: 12,
      initialDelayMs: 2_000,
      maximumDelayMs: 30_000,
      onRetry: (error, attempt, delayMs) => {
        log.warn("Reconciliation attempt failed; retrying", {
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    return;
  }
  if (command === "verify") {
    await verifyAcceptance();
    return;
  }
  throw new Error(
    `Expected "bootstrap", "reconcile", or "verify", received ${command}`,
  );
}

try {
  await main();
} catch (error) {
  log.error("Control plane failed", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
}
