import { HttpError, json, request } from "./http.js";
import { log } from "./log.js";

interface PublicSettings {
  readonly initialized?: boolean;
}

interface ArrSummary {
  readonly id?: number;
  readonly name?: string;
  readonly path?: string;
}

export class JellyseerrClient {
  private cookie = "";

  constructor(
    private readonly baseUrl: string,
    private readonly jellyfinUrl: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  async reconcile(
    sonarrUrl: string,
    sonarrApiKey: string,
    radarrUrl: string,
    radarrApiKey: string,
  ): Promise<void> {
    if (await this.isInitialized()) {
      log.info("Jellyseerr is already initialized");
      return;
    }
    await this.authenticate();
    await this.addArr("sonarr", sonarrUrl, sonarrApiKey, "/tv");
    await this.addArr("radarr", radarrUrl, radarrApiKey, "/movies");
    await request(`${this.baseUrl}/api/v1/settings/initialize`, {
      method: "POST",
      headers: this.headers(),
    });
    log.info("Jellyseerr initialization completed");
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
      Cookie: this.cookie,
    };
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
      // Jellyseerr persists its media-server settings before the setup
      // wizard is marked initialized. Resume a partially completed setup by
      // authenticating against that stored server instead of resending it.
      response = await authenticate(false);
    }
    this.cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
    if (!this.cookie) {
      throw new Error("Jellyseerr did not return an authentication cookie");
    }
  }

  private async addArr(
    kind: "sonarr" | "radarr",
    url: string,
    apiKey: string,
    fallbackDirectory: string,
  ): Promise<void> {
    const endpoint = new URL(url);
    const headers = { "X-Api-Key": apiKey };
    const [profiles, folders] = await Promise.all([
      json<ArrSummary[]>(`${url}/api/v3/qualityprofile`, { headers }),
      json<ArrSummary[]>(`${url}/api/v3/rootfolder`, { headers }),
    ]);
    const profile = profiles[0];
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
      externalUrl: "",
      syncEnabled: true,
      preventSearch: false,
      ...(kind === "sonarr"
        ? { enableSeasonFolders: true }
        : { minimumAvailability: "released" }),
    };
    await request(`${this.baseUrl}/api/v1/settings/${kind}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
    });
    log.info("Jellyseerr service reconciled", { service: kind });
  }
}
