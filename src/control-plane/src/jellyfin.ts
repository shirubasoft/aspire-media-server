import { json, request } from "./http.js";
import { log } from "./log.js";

interface PublicSystemInfo {
  readonly StartupWizardCompleted?: boolean;
}

interface AuthenticationResult {
  readonly AccessToken?: string;
}

interface VirtualFolder {
  readonly Name?: string;
  readonly CollectionType?: string;
}

interface Repository {
  readonly Name?: string;
  readonly Url?: string;
  readonly Enabled?: boolean;
}

interface Plugin {
  readonly Id?: string;
  readonly Name?: string;
}

interface ScheduledTask {
  readonly Id?: string;
  readonly Name?: string;
  readonly Key?: string;
  readonly State?: string;
}

export interface JellyfinIntegrations {
  readonly bazarrUrl: string;
  readonly bazarrApiKey: string;
  readonly jellyseerrUrl: string;
  readonly jellyseerrApiKey: string;
  readonly sonarrUrl: string;
  readonly sonarrApiKey: string;
  readonly radarrUrl: string;
  readonly radarrApiKey: string;
}

export class JellyfinClient {
  private token = "";

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
    private readonly serverName: string,
    private readonly language: string,
  ) {}

  async reconcile(integrations: JellyfinIntegrations): Promise<void> {
    const info = await json<PublicSystemInfo>(
      `${this.baseUrl}/System/Info/Public`,
    );
    if (!info.StartupWizardCompleted) {
      await this.completeStartup();
    }
    await this.authenticate();
    await this.reconcileServerName();
    await this.reconcileLibraries();
    await this.reconcileRepositories();
    await this.reconcilePluginConfigurations(integrations);
    await this.triggerIntroSkipper();
  }

  private authorization(token = this.token): string {
    const base =
      'MediaBrowser Client="Arrspire", Device="Reconciler", DeviceId="arrspire-control-plane", Version="1.0.0"';
    return token ? `${base}, Token="${token}"` : base;
  }

  private headers(): Readonly<Record<string, string>> {
    return {
      Authorization: this.authorization(),
      "Content-Type": "application/json",
    };
  }

  private async completeStartup(): Promise<void> {
    await request(`${this.baseUrl}/Startup/Configuration`, {
      method: "POST",
      headers: {
        Authorization: this.authorization(""),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ServerName: this.serverName,
        UICulture: this.language,
        MetadataCountryCode: this.language.split("-")[1] ?? "BR",
        PreferredMetadataLanguage: this.language.split("-")[0] ?? "pt",
      }),
    });
    // Jellyfin lazily initializes its first user from the GET action. Calling
    // the update action first can legitimately return 404 on a fresh server.
    await request(`${this.baseUrl}/Startup/User`, {
      headers: {
        Authorization: this.authorization(""),
      },
    });
    await request(`${this.baseUrl}/Startup/User`, {
      method: "POST",
      headers: {
        Authorization: this.authorization(""),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        Name: this.username,
        Password: this.password,
      }),
    });
    await request(`${this.baseUrl}/Startup/Complete`, {
      method: "POST",
      headers: {
        Authorization: this.authorization(""),
      },
    });
    log.info("Jellyfin startup wizard completed");
  }

  private async authenticate(): Promise<void> {
    const result = await json<AuthenticationResult>(
      `${this.baseUrl}/Users/AuthenticateByName`,
      {
        method: "POST",
        headers: {
          Authorization: this.authorization(""),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Username: this.username,
          Pw: this.password,
        }),
      },
    );
    if (!result.AccessToken) {
      throw new Error("Jellyfin authentication returned no access token");
    }
    this.token = result.AccessToken;
  }

  private async reconcileServerName(): Promise<void> {
    const config = await json<Record<string, unknown>>(
      `${this.baseUrl}/System/Configuration`,
      { headers: this.headers() },
    );
    if (config.ServerName === this.serverName) {
      return;
    }
    config.ServerName = this.serverName;
    await request(`${this.baseUrl}/System/Configuration`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(config),
    });
    log.info("Jellyfin server name reconciled");
  }

  private async reconcileLibraries(): Promise<void> {
    const existing = await json<VirtualFolder[]>(
      `${this.baseUrl}/Library/VirtualFolders`,
      { headers: this.headers() },
    );
    const libraries = [
      { name: "Movies", collectionType: "movies", path: "/media/movies" },
      { name: "TV Shows", collectionType: "tvshows", path: "/media/tv" },
      { name: "Music", collectionType: "music", path: "/media/music" },
    ] as const;
    for (const library of libraries) {
      if (
        existing.some(
          (folder) =>
            folder.Name === library.name ||
            folder.CollectionType === library.collectionType,
        )
      ) {
        continue;
      }
      const query = new URLSearchParams({
        name: library.name,
        collectionType: library.collectionType,
        paths: library.path,
        refreshLibrary: "false",
      });
      await request(
        `${this.baseUrl}/Library/VirtualFolders?${query.toString()}`,
        {
          method: "POST",
          headers: this.headers(),
        },
      );
      log.info("Jellyfin library created", { library: library.name });
    }
  }

  private async reconcileRepositories(): Promise<void> {
    const repositories = await json<Repository[]>(
      `${this.baseUrl}/Repositories`,
      { headers: this.headers() },
    );
    const desired: readonly Repository[] = [
      {
        Name: "Jellyfin Enhanced",
        Url: "https://raw.githubusercontent.com/n00bcodr/jellyfin-plugins/main/10.11/manifest.json",
        Enabled: true,
      },
      {
        Name: "File Transformation",
        Url: "https://www.iamparadox.dev/jellyfin/plugins/manifest.json",
        Enabled: true,
      },
      {
        Name: "Intro Skipper",
        Url: "https://intro-skipper.org/manifest.json",
        Enabled: true,
      },
      {
        Name: "Bazarr",
        Url: "https://raw.githubusercontent.com/enoch85/bazarr-jellyfin/main/manifest.json",
        Enabled: true,
      },
    ];
    let changed = false;
    for (const repository of desired) {
      if (!repositories.some((existing) => existing.Url === repository.Url)) {
        repositories.push(repository);
        changed = true;
      }
    }
    if (changed) {
      await request(`${this.baseUrl}/Repositories`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(repositories),
      });
      log.info("Jellyfin plugin repositories reconciled");
    }
  }

  private async reconcilePluginConfigurations(
    integrations: JellyfinIntegrations,
  ): Promise<void> {
    const plugins = await json<Plugin[]>(`${this.baseUrl}/Plugins`, {
      headers: this.headers(),
    });
    await this.reconcilePluginConfiguration(
      plugins,
      (name) => name === "Bazarr",
      {
        BazarrUrl: integrations.bazarrUrl.replace(/\/$/u, ""),
        ApiKey: integrations.bazarrApiKey,
        EnableMovies: true,
        EnableEpisodes: true,
      },
    );
    await this.reconcilePluginConfiguration(
      plugins,
      (name) => name.toLowerCase().includes("enhanced"),
      {
        JellyseerrEnabled: true,
        JellyseerrUrls: integrations.jellyseerrUrl.replace(/\/$/u, ""),
        JellyseerrApiKey: integrations.jellyseerrApiKey,
        JellyseerrShowRecommended: true,
        JellyseerrShowSimilar: true,
        JellyseerrExcludeLibraryItems: true,
        ArrLinksEnabled: true,
        SonarrUrl: integrations.sonarrUrl.replace(/\/$/u, ""),
        RadarrUrl: integrations.radarrUrl.replace(/\/$/u, ""),
        BazarrUrl: integrations.bazarrUrl.replace(/\/$/u, ""),
        ArrTagsSyncEnabled: true,
        SonarrApiKey: integrations.sonarrApiKey,
        RadarrApiKey: integrations.radarrApiKey,
        QualityTagsEnabled: true,
        LanguageTagsEnabled: true,
        ShowAudioLanguages: true,
        RandomButtonEnabled: true,
        PauseScreenEnabled: true,
        BookmarksEnabled: true,
      },
    );
  }

  private async reconcilePluginConfiguration(
    plugins: readonly Plugin[],
    matches: (name: string) => boolean,
    desired: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const plugin = plugins.find(
      (candidate) => candidate.Name && matches(candidate.Name),
    );
    if (!plugin?.Id || !plugin.Name) {
      log.warn("Jellyfin plugin is not loaded; configuration deferred");
      return;
    }
    const path = `/Plugins/${plugin.Id}/Configuration`;
    const current = await json<Record<string, unknown>>(
      `${this.baseUrl}${path}`,
      { headers: this.headers() },
    );
    const changed = Object.entries(desired)
      .filter(
        ([key, value]) =>
          JSON.stringify(current[key]) !== JSON.stringify(value),
      )
      .map(([key]) => key);
    if (changed.length === 0) {
      return;
    }
    Object.assign(current, desired);
    await request(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(current),
    });
    log.info("Jellyfin plugin configured", {
      plugin: plugin.Name,
      changed,
    });
  }

  private async triggerIntroSkipper(): Promise<void> {
    const tasks = await json<ScheduledTask[]>(
      `${this.baseUrl}/ScheduledTasks`,
      { headers: this.headers() },
    );
    const task = tasks.find((candidate) => {
      const name = `${candidate.Name ?? ""} ${candidate.Key ?? ""}`.toLowerCase();
      return (
        name.includes("intro skipper") ||
        name.includes("introskipper") ||
        name.includes("detect introduction") ||
        name.includes("analyze episodes")
      );
    });
    if (!task?.Id) {
      log.warn("Jellyfin Intro Skipper task is not loaded; scan deferred");
      return;
    }
    if (task.State === "Running") {
      return;
    }
    await request(`${this.baseUrl}/ScheduledTasks/Running/${task.Id}`, {
      method: "POST",
      headers: this.headers(),
    });
    log.info("Jellyfin Intro Skipper scan triggered");
  }
}
