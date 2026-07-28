export function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Required environment variable ${name} is missing`);
  }
  return value;
}

export function optional(name: string, fallback = ""): string {
  return process.env[name]?.trim() ?? fallback;
}

export function integer(name: string, fallback: number): number {
  const raw = optional(name);
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be an integer`);
  }
  return value;
}

export function boolean(name: string, fallback: boolean): boolean {
  const raw = optional(name).toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  throw new Error(`${name} must be a boolean`);
}
