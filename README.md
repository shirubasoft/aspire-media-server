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
aspire secret set vpn-wireguard-key
npm run dev
```

The VPN key is the only value without a safe default. Aspire generates and
persists the Jellyfin, qBittorrent, Duplicati, and Grafana passwords in its
secret store. Existing values under `~/.aspire` are reused automatically.

Runtime data defaults to `data/` in this repository, media to `~/media`, and
downloads to `~/downloads`. Override them without editing the AppHost:

```bash
ARRSPIRE_DATA_PATH=/srv/arrspire \
ARRSPIRE_MEDIA_PATH=/srv/media \
ARRSPIRE_DOWNLOADS_PATH=/srv/downloads \
npm run dev
```

Optional parameters can be changed with `aspire secret set <name>` or the
Aspire parameter commands. Useful names include `vpn-provider`,
`vpn-countries`, `timezone`, `subtitle-languages`, `minimum-seeders`, and the
supported subtitle-provider credentials.

## Tests

```bash
cd src
npm test
```

The E2E test launches a new isolated copy of the complete stack, waits for the
TypeScript bootstrap and reconciler, verifies persisted files and the real
qBittorrent, Arr, Bazarr, Jellyfin, and Jellyseerr APIs, then restarts the same
stack and verifies it again. It uses no mocks. A configured VPN secret and a
container engine are required.

## Deployment

```bash
cd src
npm run deploy
```

This non-interactively publishes the Aspire Docker Compose artifact, restricts
the generated `.env` file to the current user, selects Docker Compose or Podman
Compose, and starts the stack. Bind-mount paths and stored Aspire parameters are
materialized automatically, so an already-configured machine is not prompted
again.

To generate the artifact without starting it, run `npm run publish`. To stop a
deployed stack without deleting its bind-mounted data or named volumes, run
`npm run deploy:down`.

Set `ARRSPIRE_CONTAINER_ENGINE=docker` or `podman` to override engine detection,
`ARRSPIRE_CONTAINER_SOCKET` for a nonstandard socket, and
`ARRSPIRE_OUTPUT_PATH` to move the generated Compose artifact.

The generated `.env` contains resolved secrets and is ignored by Git. Keep it
private and do not copy it into source control.

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
