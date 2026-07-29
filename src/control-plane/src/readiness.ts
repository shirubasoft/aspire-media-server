export type Readiness = "ready" | "attention" | "failed";

export interface ReconciliationResult {
  readonly name: string;
  readonly required: boolean;
  readonly status: "ready" | "skipped" | "failed";
  readonly reason?: string;
}

export type ResultCategory =
  | "operational"
  | "needs-attention"
  | "externally-unavailable"
  | "not-configured";

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
  return results.some((result) => result.status === "failed")
    ? "attention"
    : "ready";
}

export function classifyResult(
  result: ReconciliationResult,
): ResultCategory {
  if (result.status === "ready") {
    return "operational";
  }
  if (result.status === "skipped") {
    return "not-configured";
  }
  if (!result.required && result.name.startsWith("public-indexer:")) {
    return "externally-unavailable";
  }
  return "needs-attention";
}

function nestedMessage(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = nestedMessage(item);
      if (message !== undefined) {
        return message;
      }
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["errorMessage", "message", "detail", "title"]) {
    if (typeof record[key] === "string" && record[key].trim()) {
      return record[key].trim();
    }
  }
  for (const child of Object.values(record)) {
    const message = nestedMessage(child);
    if (message !== undefined) {
      return message;
    }
  }
  return undefined;
}

export function compactReason(reason: string | undefined): string {
  if (reason === undefined) {
    return "-";
  }
  const normalized = reason.replaceAll(/\s+/gu, " ").trim();
  const jsonStart = [...normalized]
    .map((character, index) => ({ character, index }))
    .find(({ character }) => character === "[" || character === "{")?.index;
  if (jsonStart !== undefined) {
    try {
      const message = nestedMessage(
        JSON.parse(normalized.slice(jsonStart)) as unknown,
      );
      if (message !== undefined) {
        return message;
      }
    } catch {
      // The upstream error was not a complete JSON document.
    }
  }
  return normalized.length > 180
    ? `${normalized.slice(0, 177)}...`
    : normalized;
}
