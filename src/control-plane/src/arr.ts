import { json, request } from "./http.js";
import { log } from "./log.js";

type JsonObject = Record<string, unknown>;

interface Field {
  readonly name?: string;
  value?: unknown;
}

interface Schema extends JsonObject {
  readonly implementation?: string;
  readonly fields?: Field[];
}

interface Identified extends JsonObject {
  readonly id?: number;
  readonly name?: string;
}

export interface ArrClientOptions {
  readonly name: "sonarr" | "radarr" | "lidarr";
  readonly baseUrl: string;
  readonly apiVersion: "v1" | "v3";
  readonly apiKey: string;
  readonly rootFolder: "/tv" | "/movies" | "/music";
  readonly category: "sonarr" | "radarr" | "lidarr";
}

export class ArrClient {
  private readonly apiBase: string;

  constructor(private readonly options: ArrClientOptions) {
    this.apiBase = `${options.baseUrl}/api/${options.apiVersion}`;
  }

  async reconcile(
    qbittorrentUrl: string,
    qbittorrentPassword: string,
    minimumSeeders: number,
    useOriginalTitle: boolean,
  ): Promise<void> {
    await this.reconcileDownloadClient(
      qbittorrentUrl,
      qbittorrentPassword,
    );
    await this.reconcileRootFolder();
    await this.reconcileQualityProfile();
    await this.reconcileMinimumSeeders(minimumSeeders);
    if (this.options.name !== "lidarr") {
      await this.reconcileMediaManagement();
      await this.reconcileNaming(useOriginalTitle);
    }
  }

  private headers(): Readonly<Record<string, string>> {
    return {
      "Content-Type": "application/json",
      "X-Api-Key": this.options.apiKey,
    };
  }

  private async get<T>(path: string): Promise<T> {
    return json<T>(`${this.apiBase}${path}`, { headers: this.headers() });
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return json<T>(`${this.apiBase}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    return json<T>(`${this.apiBase}${path}`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
  }

  private async reconcileDownloadClient(
    qbittorrentUrl: string,
    password: string,
  ): Promise<void> {
    const existing = await this.get<Schema[]>("/downloadclient");
    const current = existing.find(
      (client) => client.implementation === "QBittorrent",
    );
    const schemas = await this.get<Schema[]>("/downloadclient/schema");
    const template = structuredClone(
      current ??
        schemas.find((schema) => schema.implementation === "QBittorrent"),
    );
    if (!template) {
      throw new Error(
        `${this.options.name} does not expose a qBittorrent schema`,
      );
    }

    const endpoint = new URL(qbittorrentUrl);
    template.enable = true;
    template.name = "qBittorrent";
    for (const field of template.fields ?? []) {
      const values: Readonly<Record<string, unknown>> = {
        host: endpoint.hostname,
        port: endpoint.port || "8080",
        username: "admin",
        password,
        tvCategory: this.options.category,
        movieCategory: this.options.category,
        musicCategory: this.options.category,
        category: this.options.category,
      };
      if (field.name && values[field.name] !== undefined) {
        field.value = values[field.name];
      }
    }

    if (current?.id) {
      await this.put(`/downloadclient/${String(current.id)}`, template);
    } else {
      await this.post("/downloadclient", template);
    }
    log.info("Download client reconciled", { service: this.options.name });
  }

  private async reconcileRootFolder(): Promise<void> {
    const current = await this.get<JsonObject[]>("/rootfolder");
    if (
      current.some((folder) => folder.path === this.options.rootFolder)
    ) {
      return;
    }
    const payload: Record<string, unknown> = {
      path: this.options.rootFolder,
    };
    if (this.options.name === "lidarr") {
      payload.name = "Music";
      const [qualityProfiles, metadataProfiles] = await Promise.all([
        this.get<Identified[]>("/qualityprofile"),
        this.get<Identified[]>("/metadataprofile"),
      ]);
      payload.defaultQualityProfileId = qualityProfiles[0]?.id;
      payload.defaultMetadataProfileId = metadataProfiles[0]?.id;
    }
    await this.post("/rootfolder", payload);
    log.info("Root folder added", {
      service: this.options.name,
      path: this.options.rootFolder,
    });
  }

  private async reconcileQualityProfile(): Promise<void> {
    const profiles = await this.get<Identified[]>("/qualityprofile");
    const profile =
      profiles.find((candidate) => candidate.name === "Any") ?? profiles[0];
    if (!profile?.id) {
      throw new Error(`${this.options.name} has no quality profile`);
    }
    let changed = false;
    if (profile.upgradeAllowed !== true) {
      profile.upgradeAllowed = true;
      changed = true;
    }
    if (this.options.name !== "lidarr" && profile.cutoff !== 7) {
      profile.cutoff = 7;
      changed = true;
    }
    if (this.options.name !== "lidarr") {
      const language = profile.language as
        | { readonly id?: number }
        | undefined;
      if (language?.id !== -2) {
        profile.language = { id: -2, name: "Original" };
        changed = true;
      }
    }
    if (changed) {
      await this.put(`/qualityprofile/${String(profile.id)}`, profile);
      log.info("Quality profile reconciled", { service: this.options.name });
    }
  }

  private async reconcileMinimumSeeders(minimumSeeders: number): Promise<void> {
    const indexers = await this.get<Identified[]>("/indexer");
    for (const indexer of indexers) {
      let changed = false;
      const fields = indexer.fields;
      if (!Array.isArray(fields)) {
        continue;
      }
      for (const field of fields as Field[]) {
        if (
          ["minimumSeeders", "seedCriteria.seeders"].includes(
            field.name ?? "",
          ) &&
          field.value !== minimumSeeders
        ) {
          field.value = minimumSeeders;
          changed = true;
        }
      }
      const currentMinimum = Number(indexer.minimumSeeders ?? 0);
      if (currentMinimum < minimumSeeders) {
        indexer.minimumSeeders = minimumSeeders;
        changed = true;
      }
      if (changed && indexer.id) {
        await this.put(`/indexer/${String(indexer.id)}`, indexer);
      }
    }
  }

  private async reconcileMediaManagement(): Promise<void> {
    const config = await this.get<Identified>("/config/mediamanagement");
    if (!config.id) {
      return;
    }
    const desired: Readonly<Record<string, unknown>> = {
      autoRenameFolders: true,
      createEmptySeriesFolders: false,
      deleteEmptyFolders: true,
      copyUsingHardlinks: true,
      importExtraFiles: true,
      extraFileExtensions: "srt,nfo",
      propersAndRepacks: "doNotPrefer",
    };
    const changed = Object.entries(desired).some(
      ([key, value]) => config[key] !== value,
    );
    if (changed) {
      Object.assign(config, desired);
      await this.put("/config/mediamanagement", config);
    }
  }

  private async reconcileNaming(useOriginalTitle: boolean): Promise<void> {
    const config = await this.get<Identified>("/config/naming");
    if (!config.id) {
      return;
    }
    const desired =
      this.options.name === "sonarr"
        ? {
            renameEpisodes: true,
            replaceIllegalCharacters: true,
            standardEpisodeFormat: useOriginalTitle
              ? "{Series Title} - S{season:00}E{episode:00} - {Episode Title} {Quality Full}"
              : "{Series TitleYear} - S{season:00}E{episode:00} - {Episode CleanTitle} {Quality Full}",
          }
        : {
            renameMovies: true,
            replaceIllegalCharacters: true,
            standardMovieFormat: useOriginalTitle
              ? "{Movie Title} ({Release Year}) {Quality Full}"
              : "{Movie CleanTitle} ({Release Year}) {Quality Full}",
          };
    if (
      Object.entries(desired).some(([key, value]) => config[key] !== value)
    ) {
      Object.assign(config, desired);
      await this.put("/config/naming", config);
    }
  }
}
