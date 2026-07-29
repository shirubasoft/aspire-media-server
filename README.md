# Arrspire

Arrspire is a TypeScript Aspire AppHost for a self-configuring media stack. It
models every service as its own domain type, starts the containers in dependency
order, and reconciles the real service APIs without Python setup scripts.

The AppHost targets the current stable Aspire CLI and has been validated with
Aspire 13.4.6.

## Stack

- Gluetun VPN, qBittorrent, Prowlarr
- Sonarr, Radarr, Lidarr, Bazarr
- Jellyfin, Jellyseerr, Recyclarr
- Duplicati, Tdarr, Diun
- Traefik, Fail2ban
- Prometheus, Grafana, and the Aspire dashboard

The bootstrap creates stable API keys and initial configuration files before
services start. The reconciler then connects qBittorrent to the Arr apps,
Prowlarr to every Arr app, Bazarr to Sonarr and Radarr, Jellyseerr to Jellyfin
and the Arr apps, and Jellyfin to Bazarr and Jellyseerr. It also installs the
pinned Jellyfin plugin set with verified checksums and writes the Recyclarr,
Traefik, Fail2ban, Prometheus, and Grafana configuration.

## First run

Prerequisites are Node.js 22+, a working Docker or Podman installation, Compose,
and the latest stable Aspire CLI.

```bash
cd src
npm ci
aspire restore --non-interactive
aspire secret set "Parameters:vpn-wireguard-key" "<wireguard-private-key>"
npm run dev
```

The VPN key is the only value without a safe default. Aspire generates and
persists the administrative-ingress, Jellyfin, qBittorrent, Duplicati, and
Grafana passwords in its secret store. Existing values under `~/.aspire` are
reused automatically.

Runtime data defaults to `data/` in this repository, media to `~/media`, and
downloads to `~/downloads`. Override them without editing the AppHost:

```bash
ARRSPIRE_DATA_PATH=/srv/arrspire \
ARRSPIRE_MEDIA_PATH=/srv/media \
ARRSPIRE_DOWNLOADS_PATH=/srv/downloads \
npm run dev
```

For local development, override a parameter with
`aspire secret set "Parameters:<name>" "<value>"`. For deployment, pass the
same parameter as an environment variable using Aspire's configuration naming,
for example `Parameters__timezone=UTC npm run deploy`. Useful names include
`vpn-provider`, `vpn-countries`, `timezone`, `subtitle-languages`,
`minimum-seeders`, and the supported subtitle-provider credentials. Dashes in
parameter names become underscores in environment-variable names.

The default locale profile keeps the original Portuguese-oriented settings.
Inspect the neutral baseline or apply it to the local Aspire secret store with:

```bash
npm run locale -- neutral
npm run locale -- neutral --apply
```

Every parameter, provider/country selection, WireGuard key, timezone, locale,
subtitle list, and host path is validated before the application services are
allowed to start. Missing optional subtitle credentials remain non-fatal; a
partially supplied username/password pair is treated as a configuration error.

## Access and readiness

Traefik is the only application resource that publishes host ports by default.
It uses ports 80/443 on rootful Docker or Podman and automatically uses
unprivileged ports 8080/8443 with rootless Podman. Override the host ports with
`ARRSPIRE_INGRESS_HTTP_PORT` and `ARRSPIRE_INGRESS_HTTPS_PORT` when needed.
Traefik redirects HTTP to HTTPS and requires the generated Arrspire ingress
credentials for administrative UIs. Jellyfin and Jellyseerr retain their own
service authentication. The insecure Traefik dashboard and direct service
ports are disabled.

After deployment, the access table and readiness summary are printed
automatically. Rerun them or repair reconciliation after supplying optional
credentials with:

```bash
npm run status
npm run repair
```

Local Aspire users can rerun the completed reconciler with
`aspire resource reconciler start --non-interactive`; its structured summary
remains visible in the Aspire dashboard.

## Tests

```bash
cd src
npm test
```

The E2E test launches a new isolated copy of the complete stack, waits for the
TypeScript bootstrap and reconciler, verifies persisted files and the real
qBittorrent, Arr, Bazarr, Jellyfin, and Jellyseerr APIs, then restarts the same
stack and verifies it again. It uses no mocks. A configured VPN secret and a
container engine are required. Because Aspire isolated mode intentionally does
not reuse user secrets, provide the VPN key explicitly:

```bash
Parameters__vpn_wireguard_key="<wireguard-private-key>" npm test
```

## Deployment

```bash
cd src
npm run deploy
```

This runs Aspire's native Docker Compose deployment pipeline, which builds the
control plane, resolves deployment parameters into an environment-specific
`.env` file, restricts generated files to the current user, selects Docker or
Podman, and starts the stack. Bind-mount paths and deployment parameters are
materialized automatically. In non-interactive environments, provide required
parameters through `Parameters__*` environment variables.

To generate the artifact without starting it, run `npm run publish`. To stop a
deployed stack without deleting its bind-mounted data or named volumes, run
`npm run deploy:down`.

Set `ARRSPIRE_CONTAINER_ENGINE=docker` or `podman` to override engine detection,
`ARRSPIRE_CONTAINER_SOCKET` for a nonstandard socket, and
`ARRSPIRE_OUTPUT_PATH` to move the generated Compose artifact.

The environment-specific `.env.<environment>` generated by deploy contains
resolved secrets and is ignored by Git. Keep it private and do not copy it into
source control. `npm run publish` produces a review artifact whose plain `.env`
contains unresolved placeholders; it is not a deployable secret file.

All application images are pinned to reviewed multi-architecture manifest
digests. Renovate proposes digest/tag updates as reviewable PRs, and CI runs
build, unit, publication-security, and real-stack compatibility checks before
an update is accepted.

See [the operations runbook](docs/operations.md) for the access model, remote
access threat assumptions, secret inventory, safe rotation and restore
procedures, image rollback policy, and exact VPN-container recovery.

## Design

The AppHost is split into typed topology, parameters, and resource classes under
`src/apphost/`. Each resource has a distinct literal kind and endpoint type, so
Sonarr, Radarr, Lidarr, and Prowlarr cannot be accidentally interchanged while
still exposing the underlying Aspire builder.

The control plane under `src/control-plane/` is a small compiled TypeScript
container with three commands:

- `bootstrap` performs deterministic pre-start file setup.
- `reconcile` waits for real APIs and converges cross-service settings.
- `verify` is the real-stack acceptance suite used by E2E tests.

Public tracker registration is best-effort because third-party availability and
bot protection are outside the stack's control. Core service configuration is
strict and fails visibly if it cannot converge.
