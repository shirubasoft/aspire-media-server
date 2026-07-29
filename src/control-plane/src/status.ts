import { writeIfChanged } from "./files.js";
import { redactForLogging } from "./log.js";
import {
  classifyReadiness,
  type Readiness,
  type ReconciliationResult,
} from "./readiness.js";

export { classifyReadiness } from "./readiness.js";
export type {
  Readiness,
  ReconciliationResult,
} from "./readiness.js";

export interface ReconciliationSummary {
  readonly schemaVersion: 2;
  readonly phase: "reconciliation";
  readonly status: Readiness;
  readonly updatedAt: string;
  readonly results: readonly ReconciliationResult[];
}

const statusDirectory = "/data/status";

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
    schemaVersion: 2,
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
