import { HttpError, json, request } from "./http.js";
import { log } from "./log.js";

interface PublicSettings {
  readonly initialized?: boolean;
}

interface ArrSummary {
  readonly id?: number;
  readonly name?: string;
  readonly hostname?: string;
  readonly path?: string;
}

export interface SeerrExternalUrls {
  readonly sonarr: string;
  readonly radarr: string;
}

export class SeerrClient {
  private cookie = "";

  constructor(
    private readonly baseUrl: string,
    private readonly jellyfinUrl: string,
    private readonly username: string,
    private readonly password: string,
    private readonly apiKey: string,
  ) {}

  async reconcile(
    sonarrUrl: string,
    sonarrApiKey: string,
    radarrUrl: string,
    radarrApiKey: string,
    externalUrls: SeerrExternalUrls,
  ): Promise<void> {
    const initialized = await this.isInitialized();
    if (initialized) {
      await this.updateJellyfin();
    } else {
      await this.authenticate();
    }
    await this.reconcileArr(
      "sonarr",
      sonarrUrl,
      sonarrApiKey,
      "/tv",
      externalUrls.sonarr,
    );
    await this.reconcileArr(
      "radarr",
      radarrUrl,
      radarrApiKey,
      "/movies",
      externalUrls.radarr,
    );
    if (!initialized) {
      await request(`${this.baseUrl}/api/v1/settings/initialize`, {
        method: "POST",
        headers: this.headers(),
      });
      log.info("Seerr initialization completed");
    } else {
      log.info("Seerr existing configuration repaired");
    }
  }

  private async isInitialized(): Promise<boolean> {
    const settings = await json<PublicSettings>(
      `${this.baseUrl}/api/v1/settings/public`,
    );
    return settings.initialized === true;
  }

  private headers(): Readonly<Record<string, string>> {
    return {
      "Content-Type": "application/json",
      "X-Api-Key": this.apiKey,
      ...(this.cookie ? { Cookie: this.cookie } : {}),
    };
  }

  private async updateJellyfin(): Promise<void> {
    const jellyfin = new URL(this.jellyfinUrl);
    await request(`${this.baseUrl}/api/v1/settings/jellyfin`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        ip: jellyfin.hostname,
        port: Number(jellyfin.port || 8096),
        useSsl: jellyfin.protocol === "https:",
        urlBase: jellyfin.pathname === "/" ? "" : jellyfin.pathname,
        externalHostname: "",
      }),
    });
    log.info("Seerr Jellyfin service reconciled");
  }

  private async authenticate(): Promise<void> {
    const jellyfin = new URL(this.jellyfinUrl);
    const endpoint = `${this.baseUrl}/api/v1/auth/jellyfin`;
    const credentials = {
      username: this.username,
      password: this.password,
    };
    const authenticate = (includeServer: boolean): Promise<Response> =>
      request(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...credentials,
          ...(includeServer
            ? {
                hostname: jellyfin.hostname,
                port: Number(jellyfin.port || 8096),
                useSsl: jellyfin.protocol === "https:",
                urlBase: "",
                serverType: 2,
              }
            : {}),
        }),
      });

    let response: Response;
    try {
      response = await authenticate(true);
    } catch (error) {
      if (
        !(error instanceof HttpError) ||
        error.status !== 500 ||
        !error.responseBody.includes(
          "Jellyfin hostname already configured",
        )
      ) {
        throw error;
      }
      // Seerr persists its media-server settings before the setup
      // wizard is marked initialized. Resume a partially completed setup by
      // authenticating against that stored server instead of resending it.
      response = await authenticate(false);
    }
    this.cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (!this.cookie) {
      throw new Error("Seerr did not return an authentication cookie");
    }
  }

  private async reconcileArr(
    kind: "sonarr" | "radarr",
    url: string,
    apiKey: string,
    fallbackDirectory: string,
    externalUrl: string,
  ): Promise<void> {
    const endpoint = new URL(url);
    const headers = { "X-Api-Key": apiKey };
    const [profiles, folders, existingServices] = await Promise.all([
      json<ArrSummary[]>(`${url}/api/v3/qualityprofile`, { headers }),
      json<ArrSummary[]>(`${url}/api/v3/rootfolder`, { headers }),
      json<ArrSummary[]>(`${this.baseUrl}/api/v1/settings/${kind}`, {
        headers: this.headers(),
      }),
    ]);
    const profile = profiles[0];
    const animeProfile = profiles.find(
      (candidate) => candidate.name === "[Anime] Remux-1080p",
    );
    const folder = folders[0];
    const payload = {
      name: kind === "sonarr" ? "Sonarr" : "Radarr",
      hostname: endpoint.hostname,
      port: Number(endpoint.port || (kind === "sonarr" ? 8989 : 7878)),
      apiKey,
      useSsl: endpoint.protocol === "https:",
      activeProfileId: profile?.id ?? 1,
      activeProfileName: profile?.name ?? "Any",
      activeDirectory: folder?.path ?? fallbackDirectory,
      is4k: false,
      isDefault: true,
      externalUrl,
      syncEnabled: true,
      preventSearch: false,
      ...(kind === "sonarr"
        ? {
            enableSeasonFolders: true,
            seriesType: "standard",
            animeSeriesType: "anime",
            activeAnimeProfileId: animeProfile?.id ?? profile?.id ?? 1,
            activeAnimeProfileName:
              animeProfile?.name ?? profile?.name ?? "Any",
            activeAnimeDirectory: folder?.path ?? fallbackDirectory,
            animeTags: [],
          }
        : { minimumAvailability: "released" }),
    };
    const existing =
      existingServices.find((service) => service.name === payload.name) ??
      (existingServices.length === 1 ? existingServices[0] : undefined);
    await request(
      `${this.baseUrl}/api/v1/settings/${kind}${
        existing?.id === undefined ? "" : `/${String(existing.id)}`
      }`,
      {
      method: existing?.id === undefined ? "POST" : "PUT",
      headers: this.headers(),
      body: JSON.stringify(payload),
      },
    );
    log.info("Seerr service reconciled", { service: kind });
  }
}
