# Arrspire operations runbook

## Access boundary and first-run handoff

Run `npm run setup` for the guided first-run flow and `npm run doctor` before
starting or deploying. Setup validates all inputs before it writes them,
stores parameters in the Aspire secret store, creates the selected
data/media/download directories, and writes only non-secret path choices to
ignored `src/.arrspire/config.json`. Environment path overrides remain
higher-priority. `npm run setup -- --non-interactive` uses existing Aspire
values plus protected `Parameters__*` and `ARRSPIRE_*_PATH` environment
variables for automation.

Doctor never changes configuration. It verifies the runtime toolchain,
container engine and Compose, secret presence and structure, paths and free
space, container socket, ingress ports, DNS, TLS inputs/certificate, ntfy
settings, and the latest bootstrap/reconciliation state. A missing deployment
or local certificate is a warning during first run; an invalid required VPN key
or inaccessible bind mount is a failure.

Traefik is the only Arrspire application service published on host ports by
default (`80` and `443`, or `8080` and `8443` when rootless Podman is
detected). Set `ARRSPIRE_INGRESS_HTTP_PORT` and
`ARRSPIRE_INGRESS_HTTPS_PORT` to override the host ports. The access handoff
includes a nonstandard HTTPS port automatically. HTTP redirects to HTTPS.
Administrative routes use a
Traefik BasicAuth middleware backed by the generated
`Parameters:ingress-admin-user` and `Parameters:ingress-admin-password`
values. Jellyfin and Seerr use their own application login so media
clients are not forced through a second authentication scheme.

Traefik uses its generated default certificate until the operator installs a
trusted certificate in `data/traefik/dynamic/`. Treat the default as suitable
for a trusted local machine or private network after explicitly trusting the
certificate. For remote access, use private-network/VPN access or trusted DNS
and a publicly trusted certificate. Do not forward ports 80/443 from an
untrusted network without reviewing every routed application's authentication,
rate limits, and patch level.

For local browser use, `npm run tls:local` creates a stable CA and wildcard
certificate for the configured Traefik domain, configures Traefik to use it,
and installs only the CA certificate in the current user's NSS browser trust
database. Restart browsers once after first use. The CA private key remains
mode `0600` under ignored runtime data. Remove the trust entry with
`certutil -D -d sql:$HOME/.pki/nssdb -n "Arrspire Local CA"` when the local
stack is retired.

### Publicly trusted LAN certificates

Set `Parameters__traefik_tls_mode=cloudflare-acme` when a client cannot import
the Arrspire local CA. Traefik then uses the Cloudflare DNS-01 challenge to
obtain and renew Let's Encrypt certificates. The server does not need public
inbound access.

1. Choose a deployment-owned suffix such as `home.example.com`.
2. In the matching Cloudflare zone, create DNS-only service records or a
   scoped wildcard record pointing to the server's LAN address.
3. Create a Cloudflare API token restricted to that zone with `Zone:Read` and
   `DNS:Edit`.
4. Supply the following deployment parameters:

   ```text
   Parameters__traefik_domain=home.example.com
   Parameters__traefik_tls_mode=cloudflare-acme
   Parameters__traefik_acme_email=operator@example.com
   Parameters__cloudflare_dns_api_token=<scoped token>
   ```

The generated Compose environment passes the token only as
`CF_DNS_API_TOKEN`; it never appears in Traefik process arguments. ACME state
persists under `data/traefik/acme/`. Keep Cloudflare proxying disabled for
private RFC1918 targets and do not forward ingress ports merely to satisfy
certificate validation. Returning to `local` mode may require rerunning
`npm run tls:local` for the selected domain.

Direct service publication is an explicit diagnostic escape hatch:

```bash
ARRSPIRE_EXPOSE_DIRECT_PORTS=true npm run dev
```

It bypasses the default ingress boundary and should only be used temporarily on
a firewalled development host. CI verifies that a normal Compose publication
contains no direct service or Aspire dashboard host ports.

`npm run deploy` prints the access and readiness handoff. `npm run status`
prints it again without revealing secret values. Representative output:

```text
Arrspire access (HTTPS)
Arrspire home     https://home.192.168.0.15.nip.io:8443           Arrspire ingress credentials
Jellyfin          https://jellyfin.192.168.0.15.nip.io:8443       Service credentials
Sonarr            https://sonarr.192.168.0.15.nip.io:8443         Arrspire ingress credentials
Traefik dashboard https://traefik.192.168.0.15.nip.io:8443        Arrspire ingress credentials

Readiness
bootstrap         ready
reconciliation    attention

External services unavailable
public-indexer:EZTV  Unable to access EZTV, blocked by Cloudflare protection

Optional integrations not configured
subtitle-provider:OpenSubtitles.org  credentials were not supplied
```

The same portal is routed from the configured bare domain. Homepage reads
service API keys from mode-`0600` files under `data/homepage/secrets/`; its
generated YAML contains only file references. Keep the portal behind the
administrative ingress boundary.

The checked-in default targets the current server at
`192.168.0.15.nip.io`. Override it with
`Parameters__traefik_domain=<address>.nip.io` if the server's LAN address
changes. Phones and other clients must be on a network that can reach the
server, and must trust only
`data/traefik/dynamic/certs/arrspire-local-ca.crt`; never distribute the CA
private key. If UFW is enabled, authorize a rule scoped to the active LAN and
published HTTPS port with:

```bash
npm run network:allow-lan
```

Set `ARRSPIRE_LAN_CIDR` when the default route is not the client-facing LAN.

`ready` means every configured integration converged; optional integrations
that were never configured remain informational. `attention` means the core
stack is usable but a configured optional integration or external service
failed. `failed` means a required integration did not converge. The latest
machine-readable summaries live in `data/status/`, and the reconciler logs the
same redacted summary in the Aspire dashboard.

### Push notifications

Arrspire supports an optional ntfy-compatible endpoint. Configure
`ntfy-topic`, optionally `ntfy-token`, and `ntfy-endpoint` for a self-hosted
server. The topic should be private and hard to guess; use a token when the
server supports access control. The token and topic are secret parameters and
remain Compose environment placeholders in review artifacts.

The internal relay accepts events only on the Compose network. It sends a
high-priority notification when required reconciliation fails, a warning when
an optional integration needs attention, a recovery notification when the
deployment returns to ready, and DIUN image-update notifications. Identical
reconciliation outcomes are deduplicated in
`data/status/notification-state.json`. Notification delivery failures appear as
an optional `notification:ntfy` readiness failure without hiding the original
reconciliation outcome. With no topic configured, the relay acknowledges
events locally and sends nothing.

After adding or correcting credentials:

```bash
# Deployed Compose stack
npm run repair

# Local Aspire run
aspire resource reconciler start --non-interactive
```

## Locale profiles and validation

The `pt-BR` profile records the original defaults:

- `America/Sao_Paulo`
- Jellyfin `pt-BR`
- subtitles `pt-BR`

The `neutral` profile uses:

- `UTC`
- Jellyfin `en-US`
- subtitles `en`

Inspect a profile with `npm run locale -- neutral`. Add `--apply` to write its
values to the local Aspire secret/configuration store. For a deployment, use
the `Parameters__*` environment rows printed by the command.

Bootstrap validates the WireGuard private key, Gluetun provider/country shape,
IANA timezone, BCP 47 locale tags, subtitle list, numeric/boolean settings,
domain, optional credential pairs, and writable non-overlapping data paths.
For an authoritative list of countries supported by a particular pinned
Gluetun image:

```bash
docker run --rm qmcgaw/gluetun@<reviewed-digest> \
  format-servers -<provider>
```

## Secret inventory and backup contract

| Secret | Class | Persisted service dependency | Backup requirement |
| --- | --- | --- | --- |
| `vpn-wireguard-key` | Required, externally managed | Gluetun tunnel | Back up in a password manager |
| `cloudflare-dns-api-token` | Required only for `cloudflare-acme` TLS | Traefik DNS-01 renewal | Store in a password manager; scope to `Zone:Read` and `DNS:Edit` for one zone |
| `ingress-admin-password` | Generated | Traefik administrative routes | Back up with the Aspire store/deployment environment |
| `jellyfin-admin-password` | Generated | Jellyfin and Seerr setup | Back up with Jellyfin data |
| `qbittorrent-password` | Generated | qBittorrent and Arr clients | Back up with qBittorrent/Arr data |
| `duplicati-encryption-key` | Generated | Duplicati settings database | Must be backed up with Duplicati data; loss can make the backup configuration unrecoverable |
| `duplicati-web-password` | Generated | Duplicati UI | Back up with Duplicati data |
| `grafana-admin-password` | Generated | Initial Grafana administrator | Back up with the Grafana volume |
| `ntfy-topic` / `ntfy-token` | Optional, externally managed | Push notification relay | Back up in a password manager; use an access-controlled or unguessable topic |
| Subtitle-provider passwords | Optional, externally managed | Only the named provider | Back up in a password manager |
| Arr/Bazarr/Seerr API keys | Generated by services | Cross-service reconciliation | Back up their configuration directories; never copy keys into diagnostics |

Local generated values are stored by Aspire under the user's Aspire
configuration. Deployment values are materialized in the mode-`0600`
`.env.<environment>` file. Protect and back up the appropriate secret store
together with `data/` and the named Grafana volume. Do not treat the review
artifact's unresolved `.env` as a secret backup.

## Safe credential rotation

Take a verified data and secret-store backup first. Rotate one credential at a
time and run `npm run repair` (or restart the local reconciler) after each
change.

- **Ingress:** set new `Parameters:ingress-admin-user` and
  `Parameters:ingress-admin-password` values, rerun bootstrap by restarting the
  stack, then verify an unauthenticated administrative request returns `401`.
- **qBittorrent:** change the password in qBittorrent, update
  `Parameters:qbittorrent-password`, run repair, and verify Sonarr/Radarr/Lidarr
  download clients. Preserve the matching parameter because the bootstrap file
  is intentionally not overwritten on restart.
- **Jellyfin:** change the administrator password in Jellyfin, update
  `Parameters:jellyfin-admin-password`, run repair, and verify Seerr.
- **Grafana:** rotate the administrator from Grafana itself, then update the
  backed-up parameter. `GF_SECURITY_ADMIN_PASSWORD` initializes a new database;
  it does not reset an existing administrator.
- **Duplicati web password:** rotate the UI password and its parameter together.
  Never casually rotate `duplicati-encryption-key`; export/verify the Duplicati
  configuration first and retain the previous key until a restore drill passes.
- **Service API keys:** rotate through the owning service UI/configuration,
  restart the dependent service if required, and run repair. Keep the old
  configuration backup until acceptance passes.

Diagnostics redact fields and known environment values whose names identify
passwords, keys, tokens, cookies, authorization, or secrets. Third-party
container logs are outside that filter; inspect them before sharing.

## Restore drill

1. Stop the stack with `npm run deploy:down`.
2. Restore `data/`, the Grafana volume, and the matching Aspire/deployment
   secrets from the same backup point.
3. Confirm paths are owned/writable by the configured host user.
4. Deploy and run `npm run status`.
5. If bootstrap is ready but reconciliation needs attention or failed, run
   `npm run repair`.
6. Verify ingress authentication, Jellyfin login/libraries, qBittorrent
   categories, Arr download clients/root folders, Prowlarr applications,
   Bazarr providers, Seerr defaults, Duplicati access, and Grafana access.
7. Keep the previous backup until a representative media read and backup
   restore both succeed.

## Seerr migration compatibility

The official Seerr image automatically migrates the existing Jellyseerr
database on first start. Arrspire keeps the host directory
`data/jellyseerr/` as the migration source and normalizes it for Seerr's
rootless UID/GID 1000 before startup. Do not rename or delete that directory.
The primary route is `https://seerr.<domain>`, while
`https://jellyseerr.<domain>` remains an alias for existing bookmarks.

Back up `data/jellyseerr/` before the first Seerr deployment. Confirm the Seerr
login, Jellyfin connection, and Sonarr/Radarr defaults before removing any
external backup of the pre-migration database.

## Image updates, security priority, and rollback

Every image reference contains a readable tag and an immutable
multi-architecture manifest digest. Renovate groups proposed image changes for
review. CI rejects floating publication, direct host exposure, and insecure
Traefik settings, then exercises unit and real-stack compatibility.

For a security release, prioritize the Renovate PR, confirm the upstream
advisory and supported architectures, and run the same checks; do not bypass
digest pinning. To roll back, revert the image-update commit (or restore the
previous reviewed tag/digest pair), publish, inspect the artifact, and redeploy.
Data migrations may be one-way, so consult the upstream release notes and take
a backup before accepting an update.

## Exact VPN-container recovery

Normal stops, interrupted startup, and abrupt AppHost termination are watched
by an engine-neutral detached lifecycle process. It removes only the exact
qBittorrent, Prowlarr, and Gluetun names for that AppHost instance. Instance and
service labels are also present for diagnosis; cleanup never uses broad name
prefixes or unscoped labels.

If the host itself killed the watchdog, recover with the exact instance ID:

```bash
ARRSPIRE_CONTAINER_ENGINE=docker npm run cleanup:vpn -- <instance-id>
# or ARRSPIRE_CONTAINER_ENGINE=podman
```

The command validates the ID and removes only
`arrspire-<instance-id>-{qbittorrent,prowlarr,gluetun}`, preserving concurrent
isolated AppHosts.
