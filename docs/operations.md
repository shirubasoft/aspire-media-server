# Arrspire operations

Run all commands below from `src`.

## Configuration precedence

Runtime path environment variables have highest priority:

- `ARRSPIRE_DATA_PATH`
- `ARRSPIRE_MEDIA_PATH`
- `ARRSPIRE_DOWNLOADS_PATH`
- `ARRSPIRE_CONTAINER_SOCKET`

Next comes `.arrspire/config.json`, written by the C# setup command. Repository
and home-directory defaults are used last. Paths must be absolute, distinct,
non-overlapping directories.

Aspire parameters can be supplied as `Parameters__name_with_underscores`
environment variables or saved through the Aspire secret store. Use:

```bash
dotnet run --project Arrspire.Operator -- setup
dotnet run --project Arrspire.Operator -- doctor
```

Important parameters include:

- `vpn-provider`, `vpn-wireguard-key`, `vpn-countries`
- `timezone`, `jellyfin-language`, `subtitle-languages`
- `traefik-domain`, `traefik-tls-mode`, `traefik-acme-email`
- `cloudflare-dns-api-token`
- `ingress-admin-user`, `ingress-admin-password`
- `ntfy-endpoint`, `ntfy-topic`, `ntfy-token`

Generated passwords and Authelia encryption keys use Aspire's persisted
parameter defaults. Preserve the Aspire secret store and the deployment
environment file when moving an installation. Duplicati's encryption key must
remain unchanged for an existing database.

## Local TLS and LAN access

For `traefik-tls-mode=local`:

```bash
dotnet run --project Arrspire.Operator -- tls-local
```

This creates a stable local CA and wildcard certificate beneath
`data/traefik/dynamic/certs`, writes Traefik's dynamic TLS configuration, and
imports the CA into the current user's NSS browser store. Restart browsers
after the first import.

To add a narrowly scoped UFW rule for the LAN subnet and published HTTPS port:

```bash
dotnet run --project Arrspire.Operator -- allow-lan
```

Set `ARRSPIRE_LAN_CIDR` when automatic route detection is unsuitable.

## Local lifecycle

Start and stop the graph through Aspire:

```bash
aspire run
aspire stop --non-interactive
```

Set `ARRSPIRE_EXPOSE_DIRECT_PORTS=true` only for temporary diagnostics. The
normal security boundary exposes Traefik alone.

Local qBittorrent and Prowlarr processes are exact-name containers managed by
the C# container runner because they must join Gluetun's container network
namespace. The runner installs a detached watchdog and removes only containers
carrying the current Arrspire instance identity.

If an interrupted run leaves them behind:

```bash
dotnet run --project Arrspire.Operator -- cleanup-vpn <instance-id>
```

Broad container deletion is intentionally unsupported.

## Publication and deployment

```bash
dotnet run --project Arrspire.Operator -- publish
dotnet run --project Arrspire.Operator -- deploy
```

Publication writes `aspire-output/docker-compose.yaml` and a private
environment file. The operator validates that:

- only Traefik publishes host ports;
- qBittorrent and Prowlarr use `service:gluetun` network mode;
- container images remain digest-pinned;
- dashboard forwarding, Authelia secret files, notification callbacks, and
  Cloudflare DNS-01 settings survive publication.

Use `ARRSPIRE_ENVIRONMENT` and `ARRSPIRE_OUTPUT_PATH` to select another
environment or output directory.

Inspect and repair:

```bash
dotnet run --project Arrspire.Operator -- status
dotnet run --project Arrspire.Operator -- repair
```

`status` combines persisted bootstrap/reconciliation readiness with Compose
container state. `repair` runs the idempotent reconciler again and prints the
new status. Stop the deployed stack with:

```bash
dotnet run --project Arrspire.Operator -- down
```

## Dashboard commands

The Homepage resource has two C# AppHost commands:

- **Show Arrspire access URL** resolves its live endpoint expression and uses
  `IInteractionService` for dashboard feedback.
- **Check container runtime** uses Aspire's container integration rather than
  invoking a hard-coded Docker command.

## Failure recovery

For a failed bootstrap, inspect `aspire logs bootstrap` and
`status/bootstrap.json`. Fix the parameter or filesystem condition and restart
the AppHost.

For a failed reconciliation, inspect `aspire logs reconciler` and
`status/reconciliation.json`, then run the repair command. Service readiness
waits are bounded; a dead dependency causes reconciliation to exit failed
instead of appearing complete.

If Duplicati reports an encryption-key mismatch, restore the original
`duplicati-encryption-key`. Changing the key does not re-encrypt its existing
database.

For a domain change:

1. stop Arrspire;
2. update `traefik-domain`;
3. regenerate local TLS when using local mode;
4. deploy and run repair;
5. update bookmarks and DNS as appropriate.

## Migration from the TypeScript AppHost

No TypeScript production process is retained. Existing persisted service data
is mounted at the same paths, and resource names, image pins, API reconciliation
behavior, ingress hostnames, Compose network mode, and readiness files remain
compatible. Remove any obsolete `dist` directory after switching branches; it
is ignored and is not loaded by the C# AppHost.

The only Node dependency is Playwright test tooling. It is not installed or
used for normal startup, bootstrap, reconciliation, publication, deployment,
or repair.
