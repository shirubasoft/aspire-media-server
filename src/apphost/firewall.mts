function isIpv4Cidr(value: string): boolean {
  const match =
    /^(?<address>(?:[0-9]{1,3}\.){3}[0-9]{1,3})\/(?<prefix>[0-9]{1,2})$/u.exec(
      value,
    );
  if (match?.groups === undefined) {
    return false;
  }
  const octets = match.groups.address
    .split(".")
    .map((octet) => Number(octet));
  const prefix = Number(match.groups.prefix);
  return (
    octets.every((octet) => octet >= 0 && octet <= 255) &&
    prefix >= 0 &&
    prefix <= 32
  );
}

export function lanIpv4Cidr(routes: string): string {
  const defaultInterface =
    /^default(?: via \S+)? dev (?<interface>\S+)/mu.exec(routes)?.groups
      ?.interface;
  if (defaultInterface === undefined) {
    throw new Error("Could not determine the default LAN interface");
  }
  for (const line of routes.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u);
    const cidr = fields[0];
    const deviceIndex = fields.indexOf("dev");
    if (
      cidr !== undefined &&
      deviceIndex >= 0 &&
      fields[deviceIndex + 1] === defaultInterface &&
      isIpv4Cidr(cidr)
    ) {
      return cidr;
    }
  }
  throw new Error(
    `Could not determine the LAN subnet for ${defaultInterface}`,
  );
}

export function ufwAllowLanArguments(
  cidr: string,
  httpsPort: number,
): readonly string[] {
  if (!isIpv4Cidr(cidr)) {
    throw new Error(`Invalid LAN IPv4 CIDR: ${cidr}`);
  }
  if (
    !Number.isInteger(httpsPort) ||
    httpsPort < 1 ||
    httpsPort > 65_535
  ) {
    throw new Error(`Invalid ingress HTTPS port: ${String(httpsPort)}`);
  }
  return [
    "ufw",
    "allow",
    "from",
    cidr,
    "to",
    "any",
    "port",
    String(httpsPort),
    "proto",
    "tcp",
    "comment",
    "Arrspire HTTPS LAN",
  ];
}
