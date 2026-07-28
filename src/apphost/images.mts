/**
 * Reviewed multi-architecture image manifests.
 *
 * Keep the human-readable tag for update discovery and pin the manifest digest
 * so restarts cannot pull a different image. Renovate updates these entries and
 * CI validates the pin format plus the published Compose artifact.
 */
export const images = {
  gluetun:
    "docker.io/qmcgaw/gluetun:latest@sha256:ad6b604e0cecc917a5cb6a8de55cd167ba415da8b7ec13456abb871a84be3c30",
  qbittorrent:
    "ghcr.io/linuxserver/qbittorrent:latest@sha256:b024436f8ca665d16d9a997d26fd27fdf867ee5566ba09f32764e7b2976d3e02",
  prowlarr:
    "lscr.io/linuxserver/prowlarr:latest@sha256:2f3d31307beba3ba2dd226d191f5f5c14ee3b4d8b49277c64683f5ed97083179",
  sonarr:
    "ghcr.io/linuxserver/sonarr:latest@sha256:24acea2956a0ccb11f103877d9f4f8576600fb34bff34820ed749c2256dab89f",
  radarr:
    "ghcr.io/linuxserver/radarr:latest@sha256:e35056574cdc695a9ee745aa1ecda9eab3842450bf4b7b8471b023790fa3861d",
  lidarr:
    "ghcr.io/linuxserver/lidarr:latest@sha256:f60ee67694bc4a218efe0fb2dc0b0021d193ac5f15be2638d17ab4eeb6966946",
  bazarr:
    "ghcr.io/linuxserver/bazarr:latest@sha256:ab401a0f361cfad328e444838b13d5b334b189d0f556fc91a3623eb581df36df",
  jellyfin:
    "docker.io/jellyfin/jellyfin:10.11.11@sha256:aefb67e6a7ff1debdd154a78a7bbb780fd0c873d8639210a7f6a2016ad2b35db",
  jellyseerr:
    "ghcr.io/fallenbagel/jellyseerr:latest@sha256:9cc9e9ee6cd5cf5a23feb45c37742ba34cfd6314d81d259cddb373a97ac92cdd",
  recyclarr:
    "ghcr.io/recyclarr/recyclarr:latest@sha256:55afe316d3e4e4e3b9120cef7c79436b1b5311f6a18d4ef4b7653e720499c90a",
  duplicati:
    "docker.io/duplicati/duplicati:latest@sha256:01f8cb81ad7d548b7ceec61d696bb5d27d8057fee0ddee37c2b8a0ff1f1729f7",
  tdarr:
    "ghcr.io/haveagitgat/tdarr:latest@sha256:eaeb1b39242685915b50f299a89f15e8ec4ef47f54d4b5b5ceee7e9d2a81c412",
  traefik:
    "docker.io/library/traefik:v3.5@sha256:16acb89c6db341182970d6fdafece31303b0a380a8ed7aa51682e225229bf1d2",
  fail2ban:
    "docker.io/crazymax/fail2ban:latest@sha256:7cd8a427a44675397398a8dace2a3d755e62c72527f8730e4fd37697731a9321",
  diun:
    "docker.io/crazymax/diun:latest@sha256:e324b793eb32dfb7f74d3a39421ebf090141caaadee69b8f78da63112408ee25",
  prometheus:
    "docker.io/prom/prometheus:latest@sha256:3c42b892cf723fa54d2f262c37a0e1f80aa8c8ddb1da7b9b0df9455a35a7f893",
  grafana:
    "docker.io/grafana/grafana:latest@sha256:1c1bd67c54c5fcf6e759897852b5a584191bd6796e8d328a5ace457799801261",
} as const;

export const aspireDashboardDigest =
  "sha256:187fe35d9ebe913d2f0cb40e629a4a2802e591b84f3fd5fdbfb7341fe1746351";
