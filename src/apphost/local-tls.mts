import { execFile } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface LocalTlsAssets {
  readonly caCertificate: string;
  readonly certificate: string;
  readonly privateKey: string;
  readonly traefikConfiguration: string;
}

type CommandRunner = (
  command: string,
  args: readonly string[],
) => Promise<unknown>;

async function defaultRunner(
  command: string,
  args: readonly string[],
): Promise<void> {
  await execute(command, [...args]);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function validateDomain(domain: string): void {
  if (
    domain.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(domain)
  ) {
    throw new Error(`Invalid local TLS domain: ${domain}`);
  }
}

function opensslConfiguration(domain: string): string {
  const serviceHostnames = [
    "jellyfin",
    "jellyseerr",
    "sonarr",
    "radarr",
    "lidarr",
    "prowlarr",
    "bazarr",
    "qbittorrent",
    "duplicati",
    "tdarr",
    "prometheus",
    "grafana",
    "traefik",
  ].map((service) => `${service}.${domain}`);
  const altNames = [
    `*.${domain}`,
    domain,
    ...serviceHostnames,
  ]
    .map((hostname, index) => `DNS.${String(index + 1)} = ${hostname}`)
    .join("\n");
  return `[req]
distinguished_name = subject
req_extensions = v3_req
prompt = no

[subject]
CN = *.${domain}

[v3_req]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
${altNames}
`;
}

function traefikConfiguration(): string {
  return `tls:
  certificates:
    - certFile: /etc/traefik/dynamic/certs/arrspire-local.crt
      keyFile: /etc/traefik/dynamic/certs/arrspire-local.key
  stores:
    default:
      defaultCertificate:
        certFile: /etc/traefik/dynamic/certs/arrspire-local.crt
        keyFile: /etc/traefik/dynamic/certs/arrspire-local.key
`;
}

export async function generateLocalTls(
  dataPath: string,
  domain: string,
  run: CommandRunner = defaultRunner,
): Promise<LocalTlsAssets> {
  validateDomain(domain);
  const dynamicDirectory = join(dataPath, "traefik", "dynamic");
  const certificateDirectory = join(dynamicDirectory, "certs");
  const caPrivateKey = join(certificateDirectory, "arrspire-local-ca.key");
  const caCertificate = join(certificateDirectory, "arrspire-local-ca.crt");
  const privateKey = join(certificateDirectory, "arrspire-local.key");
  const certificate = join(certificateDirectory, "arrspire-local.crt");
  const request = join(certificateDirectory, "arrspire-local.csr");
  const serial = join(certificateDirectory, "arrspire-local-ca.srl");
  const opensslConfig = join(certificateDirectory, "openssl.cnf");
  const domainMarker = join(certificateDirectory, "domain");
  const traefikTls = join(dynamicDirectory, "tls.yml");

  await mkdir(certificateDirectory, { recursive: true, mode: 0o700 });
  if (!(await exists(caPrivateKey)) || !(await exists(caCertificate))) {
    await run("openssl", ["genrsa", "-out", caPrivateKey, "4096"]);
    await run("openssl", [
      "req",
      "-x509",
      "-new",
      "-key",
      caPrivateKey,
      "-sha256",
      "-days",
      "3650",
      "-subj",
      "/CN=Arrspire Local CA",
      "-out",
      caCertificate,
    ]);
  }

  let previousDomain = "";
  try {
    previousDomain = (await readFile(domainMarker, "utf8")).trim();
  } catch {
    // A missing marker means the leaf certificate needs to be generated.
  }
  if (
    previousDomain !== domain ||
    !(await exists(privateKey)) ||
    !(await exists(certificate))
  ) {
    await writeFile(opensslConfig, opensslConfiguration(domain), {
      mode: 0o600,
    });
    await run("openssl", ["genrsa", "-out", privateKey, "2048"]);
    await run("openssl", [
      "req",
      "-new",
      "-key",
      privateKey,
      "-out",
      request,
      "-config",
      opensslConfig,
    ]);
    await run("openssl", [
      "x509",
      "-req",
      "-in",
      request,
      "-CA",
      caCertificate,
      "-CAkey",
      caPrivateKey,
      "-CAcreateserial",
      "-out",
      certificate,
      "-days",
      "825",
      "-sha256",
      "-extfile",
      opensslConfig,
      "-extensions",
      "v3_req",
    ]);
    await writeFile(domainMarker, `${domain}\n`, { mode: 0o600 });
    await rm(request, { force: true });
    await rm(serial, { force: true });
  }

  await writeFile(traefikTls, traefikConfiguration(), { mode: 0o644 });
  await Promise.all([
    chmod(caPrivateKey, 0o600),
    chmod(privateKey, 0o600),
    chmod(caCertificate, 0o644),
    chmod(certificate, 0o644),
  ]);
  return {
    caCertificate,
    certificate,
    privateKey,
    traefikConfiguration: traefikTls,
  };
}
