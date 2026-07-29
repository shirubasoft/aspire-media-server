import assert from "node:assert/strict";
import test from "node:test";

import {
  lanIpv4Cidr,
  ufwAllowLanArguments,
} from "../firewall.mjs";

void test("repairs UFW access only for the active LAN subnet", () => {
  const routes = `default via 192.168.0.1 dev enp7s0 proto dhcp src 192.168.0.15
192.168.0.0/24 dev enp7s0 proto kernel scope link src 192.168.0.15
10.89.0.0/16 dev podman0 proto kernel scope link src 10.89.0.1
`;

  assert.deepEqual(
    ufwAllowLanArguments(lanIpv4Cidr(routes), 8443),
    [
      "ufw",
      "allow",
      "from",
      "192.168.0.0/24",
      "to",
      "any",
      "port",
      "8443",
      "proto",
      "tcp",
      "comment",
      "Arrspire HTTPS LAN",
    ],
  );
});

void test("rejects invalid firewall scopes and ports", () => {
  assert.throws(
    () => ufwAllowLanArguments("192.168.0.999/24", 8443),
    /Invalid LAN IPv4 CIDR/u,
  );
  assert.throws(
    () => ufwAllowLanArguments("192.168.0.0/24", 70_000),
    /Invalid ingress HTTPS port/u,
  );
});
