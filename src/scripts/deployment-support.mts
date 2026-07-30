interface PodmanContainer {
  readonly Id?: unknown;
  readonly Labels?: unknown;
}

export interface PodmanRecoveryPlan {
  readonly dependents: readonly string[];
  readonly infrastructure: readonly string[];
}

export interface CloudflareZone {
  readonly id: string;
  readonly name: string;
}

export interface CloudflareDnsRecord {
  readonly id: string;
  readonly type: string;
  readonly name: string;
  readonly content: string;
  readonly proxied?: boolean;
  readonly ttl?: number;
}

export interface HomepageDnsPlan {
  readonly action: "create" | "reuse";
  readonly record: CloudflareDnsRecord;
}

function labels(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

export function parameterEnvironment(
  values: unknown,
  currentEnvironment: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  if (typeof values !== "object" || values === null || Array.isArray(values)) {
    return {};
  }

  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith("Parameters:") || typeof value !== "string") {
      continue;
    }
    const parameterName = key
      .slice("Parameters:".length)
      .replaceAll("-", "_");
    const environmentName = `Parameters__${parameterName}`;
    if (currentEnvironment[environmentName] === undefined) {
      environment[environmentName] = value;
    }
  }
  return environment;
}

export function isPodmanNetworkDependencyFailure(output: string): boolean {
  return (
    output.includes("has dependent containers which must be removed before it") &&
    output.includes("gluetun")
  );
}

export function podmanRecoveryPlan(
  document: unknown,
  projectName: string,
): PodmanRecoveryPlan | undefined {
  if (!Array.isArray(document)) {
    return undefined;
  }

  const serviceContainers = document
    .filter(
      (item): item is PodmanContainer =>
        typeof item === "object" && item !== null,
    )
    .flatMap((container) => {
      const containerLabels = labels(container.Labels);
      const project = containerLabels["com.docker.compose.project"];
      const service = containerLabels["com.docker.compose.service"];
      const id = container.Id;
      return project === projectName &&
        typeof service === "string" &&
        typeof id === "string" &&
        id !== ""
        ? [{ id, service }]
        : [];
    });

  const dependents = serviceContainers
    .filter(({ service }) =>
      service === "qbittorrent" || service === "prowlarr"
    )
    .map(({ id }) => id);
  const infrastructure = serviceContainers
    .filter(({ service }) =>
      service === "gluetun" || service === "traefik"
    )
    .map(({ id }) => id);

  return dependents.length > 0 &&
      serviceContainers.some(({ service }) => service === "gluetun")
    ? { dependents, infrastructure }
    : undefined;
}

export function cloudflareZoneForDomain(
  zones: readonly CloudflareZone[],
  domain: string,
): CloudflareZone | undefined {
  return zones
    .filter(
      (zone) => domain === zone.name || domain.endsWith(`.${zone.name}`),
    )
    .sort((left, right) => right.name.length - left.name.length)[0];
}

export function homepageDnsPlan(
  records: readonly CloudflareDnsRecord[],
  domain: string,
): HomepageDnsPlan | undefined {
  const exact = records.find((record) => record.name === domain);
  if (exact !== undefined) {
    return ["A", "AAAA"].includes(exact.type)
      ? { action: "reuse", record: exact }
      : undefined;
  }

  const wildcard = records.find(
    (record) =>
      record.name === `*.${domain}` && ["A", "AAAA"].includes(record.type),
  );
  return wildcard === undefined
    ? undefined
    : {
        action: "create",
        record: {
          ...wildcard,
          id: "",
          name: domain,
          proxied: false,
        },
      };
}
