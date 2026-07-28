import { writeIfChanged } from "./files.js";
import { redactForLogging } from "./log.js";

export type Readiness = "ready" | "degraded" | "failed";

export interface ReconciliationResult {
  readonly name: string;
  readonly required: boolean;
  readonly status: "ready" | "skipped" | "failed";
  readonly reason?: string;
}

export interface ReconciliationSummary {
  readonly schemaVersion: 1;
  readonly phase: "reconciliation";
  readonly status: Readiness;
  readonly updatedAt: string;
  readonly results: readonly ReconciliationResult[];
}

const statusDirectory = "/data/status";

export function classifyReadiness(
  results: readonly ReconciliationResult[],
): Readiness {
  if (
    results.some(
      (result) => result.required && result.status === "failed",
    )
  ) {
    return "failed";
  }
  return results.some((result) => result.status !== "ready")
    ? "degraded"
    : "ready";
}

export async function writeBootstrapStatus(): Promise<void> {
  await writeIfChanged(
    `${statusDirectory}/bootstrap.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        phase: "bootstrap",
        status: "ready",
        updatedAt: new Date().toISOString(),
      },
      undefined,
      2,
    )}\n`,
    0o644,
  );
}

export async function writeReconciliationStatus(
  results: readonly ReconciliationResult[],
): Promise<ReconciliationSummary> {
  const redactedResults = redactForLogging(
    results,
  ) as readonly ReconciliationResult[];
  const status = classifyReadiness(redactedResults);
  const summary: ReconciliationSummary = {
    schemaVersion: 1,
    phase: "reconciliation",
    status,
    updatedAt: new Date().toISOString(),
    results: redactedResults,
  };
  await writeIfChanged(
    `${statusDirectory}/reconciliation.json`,
    `${JSON.stringify(summary, undefined, 2)}\n`,
    0o644,
  );
  return summary;
}
