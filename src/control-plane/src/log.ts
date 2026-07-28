type LogFields = Readonly<Record<string, unknown>>;

function write(
  level: "info" | "warn" | "error",
  message: string,
  fields: LogFields = {},
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const output = JSON.stringify(payload);
  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const log = {
  info: (message: string, fields?: LogFields) =>
    write("info", message, fields),
  warn: (message: string, fields?: LogFields) =>
    write("warn", message, fields),
  error: (message: string, fields?: LogFields) =>
    write("error", message, fields),
};
