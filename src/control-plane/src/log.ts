type LogFields = Readonly<Record<string, unknown>>;
const sensitiveName = /(?:api[-_]?key|authorization|cookie|credential|password|private[-_]?key|secret|token)/iu;

function knownSecretValues(): readonly string[] {
  return Object.entries(process.env)
    .filter(
      ([name, value]) =>
        value !== undefined && value.length >= 4 && sensitiveName.test(name),
    )
    .map(([, value]) => value as string)
    .sort((left, right) => right.length - left.length);
}

function redactString(value: string): string {
  let redacted = value
    .replaceAll(
      /((?:api[-_]?key|authorization|cookie|credential|password|private[-_]?key|secret|token)["']?\s*[:=]\s*["']?)[^"',;\s}]+/giu,
      "$1[REDACTED]",
    )
    .replaceAll(/(https?:\/\/)[^/@\s]+@/giu, "$1[REDACTED]@");
  for (const secret of knownSecretValues()) {
    redacted = redacted.replaceAll(secret, "[REDACTED]");
  }
  return redacted;
}

export function redactForLogging(
  value: unknown,
  propertyName = "",
): unknown {
  if (sensitiveName.test(propertyName)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForLogging(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        redactForLogging(item, name),
      ]),
    );
  }
  return value;
}

function write(
  level: "info" | "warn" | "error",
  message: string,
  fields: LogFields = {},
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(redactForLogging(fields) as LogFields),
  };
  const output = JSON.stringify(payload);
  // Aspire captures the resource's stdout as its structured log stream.
  // Keep every severity on that stream; `level` remains the source of truth
  // for filtering and alerting.
  console.log(output);
}

export const log = {
  info: (message: string, fields?: LogFields) =>
    write("info", message, fields),
  warn: (message: string, fields?: LogFields) =>
    write("warn", message, fields),
  error: (message: string, fields?: LogFields) =>
    write("error", message, fields),
};
