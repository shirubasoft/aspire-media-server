export function publicServiceUrl(
  service: string,
  domain: string,
  httpsPort: number,
): string {
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65_535) {
    throw new Error("INGRESS_HTTPS_PORT must be a valid TCP port (1-65535)");
  }
  const url = new URL(`https://${service}.${domain}`);
  if (httpsPort !== 443) {
    url.port = String(httpsPort);
  }
  return url.origin;
}
