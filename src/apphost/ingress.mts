export interface IngressPorts {
  readonly http: number;
  readonly https: number;
}

export const defaultTraefikDomain = "192.168.0.15.nip.io";

function port(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  const resolved = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 65_535) {
    throw new Error(`${name} must be a valid TCP port (1-65535)`);
  }
  return resolved;
}

export function resolveIngressPorts(
  rootlessPodman: boolean,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): IngressPorts {
  const http = port(
    "ARRSPIRE_INGRESS_HTTP_PORT",
    environment.ARRSPIRE_INGRESS_HTTP_PORT,
    rootlessPodman ? 8080 : 80,
  );
  const https = port(
    "ARRSPIRE_INGRESS_HTTPS_PORT",
    environment.ARRSPIRE_INGRESS_HTTPS_PORT,
    rootlessPodman ? 8443 : 443,
  );
  if (http === https) {
    throw new Error("HTTP and HTTPS ingress ports must differ");
  }
  return { http, https };
}

export function publishedTraefikHttpsPort(compose: string): number {
  let service = "";
  let inPorts = false;
  for (const line of compose.split(/\r?\n/u)) {
    const serviceMatch = /^  ([a-z0-9][a-z0-9-]*):$/u.exec(line);
    if (serviceMatch?.[1] !== undefined) {
      service = serviceMatch[1];
      inPorts = false;
      continue;
    }
    if (service === "traefik" && /^    ports:$/u.test(line)) {
      inPorts = true;
      continue;
    }
    if (!inPorts) {
      continue;
    }
    const published = /([0-9]+):443(?:\/tcp)?"/u.exec(line)?.[1];
    if (published !== undefined) {
      return port("published Traefik HTTPS port", published, 443);
    }
    if (/^    \S/u.test(line) || /^  \S/u.test(line)) {
      break;
    }
  }
  return 443;
}

export function httpsServiceUrl(
  service: string,
  domain: string,
  httpsPort: number,
): string {
  return `https://${service}.${domain}${httpsPort === 443 ? "" : `:${String(httpsPort)}`}`;
}
