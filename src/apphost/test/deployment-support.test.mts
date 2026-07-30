import assert from "node:assert/strict";
import test from "node:test";

import {
  cloudflareZoneForDomain,
  homepageDnsPlan,
  isPodmanNetworkDependencyFailure,
  parameterEnvironment,
  podmanRecoveryPlan,
} from "../../scripts/deployment-support.mjs";

void test("maps Aspire parameter secrets without overriding explicit inputs", () => {
  assert.deepEqual(
    parameterEnvironment(
      {
        "Parameters:traefik-domain": "home.example.com",
        "Parameters:timezone": "UTC",
        unrelated: "ignored",
      },
      { Parameters__timezone: "America/Sao_Paulo" },
    ),
    {
      Parameters__traefik_domain: "home.example.com",
    },
  );
});

void test("recognizes only the Podman Gluetun dependency failure", () => {
  assert.equal(
    isPodmanNetworkDependencyFailure(
      "Container arrspire-gluetun-1 Error: container has dependent containers which must be removed before it",
    ),
    true,
  );
  assert.equal(
    isPodmanNetworkDependencyFailure("image build failed for gluetun"),
    false,
  );
});

void test("removes VPN dependents before Gluetun and staged Traefik containers", () => {
  const container = (id: string, project: string, service: string) => ({
    Id: id,
    Labels: {
      "com.docker.compose.project": project,
      "com.docker.compose.service": service,
    },
  });
  assert.deepEqual(
    podmanRecoveryPlan(
      [
        container("qbit", "arrspire", "qbittorrent"),
        container("prowlarr", "arrspire", "prowlarr"),
        container("gluetun-old", "arrspire", "gluetun"),
        container("gluetun-new", "arrspire", "gluetun"),
        container("traefik-old", "arrspire", "traefik"),
        container("other", "unrelated", "qbittorrent"),
      ],
      "arrspire",
    ),
    {
      dependents: ["qbit", "prowlarr"],
      infrastructure: ["gluetun-old", "gluetun-new", "traefik-old"],
    },
  );
});

void test("does not plan Podman recovery without a Gluetun dependency", () => {
  assert.equal(
    podmanRecoveryPlan(
      [
        {
          Id: "gluetun",
          Labels: {
            "com.docker.compose.project": "arrspire",
            "com.docker.compose.service": "gluetun",
          },
        },
      ],
      "arrspire",
    ),
    undefined,
  );
});

void test("selects the most specific Cloudflare zone", () => {
  assert.deepEqual(
    cloudflareZoneForDomain(
      [
        { id: "one", name: "dev" },
        { id: "two", name: "shiruba.dev" },
      ],
      "home.shiruba.dev",
    ),
    { id: "two", name: "shiruba.dev" },
  );
});

void test("reuses the exact Homepage address when it exists", () => {
  const record = {
    id: "exact",
    type: "A",
    name: "home.shiruba.dev",
    content: "192.168.0.15",
    proxied: false,
  };
  assert.deepEqual(
    homepageDnsPlan([record], "home.shiruba.dev"),
    { action: "reuse", record },
  );
});

void test("copies a scoped wildcard into a DNS-only bare Homepage record", () => {
  assert.deepEqual(
    homepageDnsPlan(
      [
        {
          id: "wildcard",
          type: "A",
          name: "*.home.shiruba.dev",
          content: "192.168.0.15",
          proxied: false,
          ttl: 1,
        },
      ],
      "home.shiruba.dev",
    ),
    {
      action: "create",
      record: {
        id: "",
        type: "A",
        name: "home.shiruba.dev",
        content: "192.168.0.15",
        proxied: false,
        ttl: 1,
      },
    },
  );
});

void test("will not replace an unexpected exact DNS record", () => {
  assert.equal(
    homepageDnsPlan(
      [
        {
          id: "cname",
          type: "CNAME",
          name: "home.shiruba.dev",
          content: "other.example.com",
        },
      ],
      "home.shiruba.dev",
    ),
    undefined,
  );
});
