# Arrspire

Arrspire is a C# Aspire AppHost for a self-configuring media server. It models
the complete stack, bootstraps persisted configuration, reconciles the real
service APIs, exposes one authenticated HTTPS ingress, and publishes the same
graph to Docker or Podman Compose.

The production path is fully .NET:

- `Arrspire.AppHost` declares resources and publication behavior.
- `Arrspire.ControlPlane` performs bootstrap, reconciliation, acceptance, and
  notification relay work.
- `Arrspire.ContainerRunner` safely manages the two containers that share
  Gluetun's network namespace during local Aspire runs.
- `Arrspire.Operator` provides setup, diagnostics, TLS, deployment, status,
  repair, firewall, locale, and cleanup commands.

TypeScript is used only by the Playwright browser acceptance test.

## Requirements

- .NET 10 SDK
- Aspire CLI 13.4 or newer
- Docker or Podman, including Compose
- OpenSSL and `certutil` for locally trusted TLS
- A WireGuard private key supported by Gluetun

## Quick start

Run commands from `src`:

```bash
cd src
dotnet run --project Arrspire.Operator -- setup
dotnet run --project Arrspire.Operator -- doctor
dotnet build Arrspire.slnx
aspire run
```

For unattended setup, supply protected `Parameters__*` environment variables:

```bash
Parameters__vpn_wireguard_key="<private-key>" \
  dotnet run --project Arrspire.Operator -- setup --non-interactive
```

The default ingress domain is `192.168.0.15.nip.io`. Local Docker publishes
ports 80 and 443; rootless Podman defaults to 8080 and 8443. Override them with
`ARRSPIRE_INGRESS_HTTP_PORT` and `ARRSPIRE_INGRESS_HTTPS_PORT`.

Generate and trust the local CA after changing the domain:

```bash
dotnet run --project Arrspire.Operator -- tls-local
```

## Deploy and operate

Use the C# operator so publication validation, secret-store forwarding, file
permissions, and readiness reporting remain consistent:

```bash
dotnet run --project Arrspire.Operator -- publish
dotnet run --project Arrspire.Operator -- deploy
dotnet run --project Arrspire.Operator -- status
dotnet run --project Arrspire.Operator -- repair
dotnet run --project Arrspire.Operator -- down
```

Other workflows:

```bash
dotnet run --project Arrspire.Operator -- locale neutral
dotnet run --project Arrspire.Operator -- locale neutral --apply
dotnet run --project Arrspire.Operator -- allow-lan
dotnet run --project Arrspire.Operator -- cleanup-vpn <instance-id>
```

The AppHost also places commands on the Homepage resource. They resolve the
live endpoint through an endpoint expression, show it through Aspire's
`IInteractionService`, and query Aspire's container runtime integration.

## Architecture

The C# AppHost uses features that were unavailable to the former TypeScript
AppHost:

- `WithContainerFiles` generates Traefik's static configuration without a
  host-side staging directory.
- Docker Compose publication callbacks set restart policies, devices,
  capabilities, service-network mode, and dashboard settings.
- endpoint expressions flow live service URLs into the C# control plane and
  notification callbacks.
- lifecycle callbacks validate the selected Docker or Podman runtime before
  startup.
- `IInteractionService` and custom resource commands provide dashboard-native
  operator feedback.
- generated persisted parameters keep secrets stable without a parallel
  TypeScript configuration layer.

Bootstrap runs once before dependent services. Reconciliation waits for actual
service APIs and then configures qBittorrent, Jellyfin, Sonarr, Radarr, Lidarr,
Prowlarr, Bazarr, Seerr, Tdarr, Duplicati, Recyclarr, Homepage, Traefik,
Authelia, Prometheus, Grafana, and notifications. Readiness is written under
the configured data path in `status/bootstrap.json` and
`status/reconciliation.json`.

All application images are pinned by manifest digest. By default, only Traefik
publishes host ports. qBittorrent and Prowlarr share Gluetun's network
namespace both locally and in Compose publication.

## Tests

```bash
cd src
dotnet test Arrspire.slnx --configuration Release
aspire deploy --list-steps --non-interactive
dotnet run --project Arrspire.Operator -- publish
```

The optional real-stack browser acceptance test remains Playwright-based:

```bash
npm ci
npx playwright install chromium
Parameters__vpn_wireguard_key="<private-key>" npm test
```

See [operations.md](docs/operations.md) for parameters, recovery, and migration
details.
