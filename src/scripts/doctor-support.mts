export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly fix?: string;
}

export function supportedNodeVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (match?.[1] === undefined || match[2] === undefined) {
    return false;
  }
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  return (
    major >= 24 ||
    (major === 22 && minor >= 13) ||
    (major === 20 && minor >= 19)
  );
}

export function diskSpaceCheck(
  name: string,
  availableBytes: number,
): DoctorCheck {
  const gib = availableBytes / 1024 ** 3;
  const detail = `${gib.toFixed(1)} GiB available`;
  if (gib < 2) {
    return {
      name,
      status: "fail",
      detail,
      fix: "Free at least 2 GiB before starting Arrspire.",
    };
  }
  if (gib < 10) {
    return {
      name,
      status: "warn",
      detail,
      fix: "Free disk space soon; media automation can consume storage quickly.",
    };
  }
  return { name, status: "pass", detail };
}

export function parseAspireParameters(
  value: unknown,
): Readonly<Record<string, string>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        (entry): entry is [string, string] =>
          entry[0].startsWith("Parameters:") && typeof entry[1] === "string",
      )
      .map(([name, parameter]) => [
        name.slice("Parameters:".length),
        parameter,
      ]),
  );
}
