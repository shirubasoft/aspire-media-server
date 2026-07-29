import { createHash } from "node:crypto";

import { form, json, request } from "./http.js";
import { log } from "./log.js";

interface LanguageProfile {
  readonly profileId?: number;
  readonly name?: string;
  readonly items?: readonly { readonly language?: string }[];
}

interface ProviderCredentials {
  readonly opensubtitlesComUser: string;
  readonly opensubtitlesComPassword: string;
  readonly opensubtitlesOrgUser: string;
  readonly opensubtitlesOrgPassword: string;
  readonly legendasDivxUser: string;
  readonly legendasDivxPassword: string;
  readonly legendasNetUser: string;
  readonly legendasNetPassword: string;
}

export function bazarrLanguageCode(language: string): string {
  return language.toLowerCase() === "pt-br" ? "pb" : language;
}

export class BazarrClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async reconcile(
    sonarrUrl: string,
    sonarrApiKey: string,
    radarrUrl: string,
    radarrApiKey: string,
    languages: readonly string[],
    credentials: ProviderCredentials,
  ): Promise<void> {
    await this.reconcileArr("sonarr", sonarrUrl, sonarrApiKey);
    await this.reconcileArr("radarr", radarrUrl, radarrApiKey);
    const bazarrLanguages = languages.map(bazarrLanguageCode);
    const profileId = await this.reconcileLanguageProfile(bazarrLanguages);
    await this.postSettings({
      "settings-general-serie_default_enabled": "true",
      "settings-general-serie_default_language":
        JSON.stringify(bazarrLanguages),
      "settings-general-serie_default_profile": String(profileId),
      "settings-general-movie_default_enabled": "true",
      "settings-general-movie_default_language":
        JSON.stringify(bazarrLanguages),
      "settings-general-movie_default_profile": String(profileId),
      "settings-sonarr-minimum_score": "90",
      "settings-radarr-minimum_score": "80",
      "settings-subsync-use_subsync": "true",
      "settings-subsync-use_subsync_threshold": "true",
      "settings-subsync-subsync_threshold": "96",
      "settings-subsync-use_subsync_movie_threshold": "true",
      "settings-subsync-subsync_movie_threshold": "86",
      "settings-general-serie_default_hi": "2",
      "settings-general-movie_default_hi": "2",
    });
    await this.reconcileProviders(credentials);
    log.info("Bazarr settings reconciled");
  }

  private headers(): Readonly<Record<string, string>> {
    return { "X-API-KEY": this.apiKey };
  }

  private async postSettings(
    settings: Readonly<Record<string, string>>,
  ): Promise<void> {
    await request(`${this.baseUrl}/api/system/settings`, {
      method: "POST",
      headers: this.headers(),
      body: form(settings),
      expected: [200, 204],
    });
  }

  private async reconcileArr(
    name: "sonarr" | "radarr",
    url: string,
    apiKey: string,
  ): Promise<void> {
    const endpoint = new URL(url);
    const title = name[0]?.toUpperCase() + name.slice(1);
    const settings: Record<string, string> = {
      [`settings-general-use_${name}`]: "true",
      [`settings-${name}-ip`]: endpoint.hostname,
      [`settings-${name}-port`]:
        endpoint.port || (name === "sonarr" ? "8989" : "7878"),
      [`settings-${name}-base_url`]: "/",
      [`settings-${name}-ssl`]: String(endpoint.protocol === "https:"),
      [`settings-${name}-apikey`]: apiKey,
      [`settings-${name}-only_monitored`]: "false",
      [`settings-${name}-${name === "sonarr" ? "series" : "movies"}_sync`]:
        "60",
      [`settings-${name}-full_update`]: "Daily",
      [`settings-${name}-full_update_day`]: "6",
      [`settings-${name}-full_update_hour`]: "4",
    };
    await this.postSettings(settings);
    log.info(`Bazarr ${title} connection reconciled`);
  }

  private async reconcileLanguageProfile(
    languages: readonly string[],
  ): Promise<number> {
    const profiles = await json<LanguageProfile[]>(
      `${this.baseUrl}/api/system/languages/profiles`,
      { headers: this.headers() },
    );
    const exact = profiles.find((profile) => {
      const current = (profile.items ?? [])
        .map((item) => item.language)
        .filter((value): value is string => Boolean(value))
        .sort();
      return current.join(",") === [...languages].sort().join(",");
    });
    if (exact?.profileId !== undefined) {
      return exact.profileId;
    }

    const digest = createHash("sha256")
      .update([...languages].sort().join(","))
      .digest();
    const profileId = (digest.readUInt32BE(0) % 900_000) + 100_000;
    const profile = {
      profileId,
      name: languages.join(" + "),
      items: languages.map((language, index) => ({
        id: index + 1,
        language,
        audio_exclude: "False",
        hi: "False",
        forced: "False",
      })),
      cutoff: null,
      mustContain: [],
      mustNotContain: [],
      originalFormat: false,
    };
    await this.postSettings({
      "languages-profiles": JSON.stringify([...profiles, profile]),
    });
    return profileId;
  }

  private async reconcileProviders(
    credentials: ProviderCredentials,
  ): Promise<void> {
    const providers = new URLSearchParams();
    const addProvider = (
      name: string,
      settings: Readonly<Record<string, string>>,
    ): void => {
      providers.append("settings-general-enabled_providers", name);
      for (const [key, value] of Object.entries(settings)) {
        providers.append(`settings-${name}-${key}`, value);
      }
    };

    addProvider("podnapisi", {});
    if (
      credentials.opensubtitlesComUser &&
      credentials.opensubtitlesComPassword
    ) {
      addProvider("opensubtitlescom", {
        username: credentials.opensubtitlesComUser,
        password: credentials.opensubtitlesComPassword,
        use_hash: "true",
        include_ai_translated: "false",
      });
    }
    if (
      credentials.opensubtitlesOrgUser &&
      credentials.opensubtitlesOrgPassword
    ) {
      addProvider("opensubtitles", {
        username: credentials.opensubtitlesOrgUser,
        password: credentials.opensubtitlesOrgPassword,
        vip: "true",
        ssl: "false",
      });
    }
    if (credentials.legendasDivxUser && credentials.legendasDivxPassword) {
      addProvider("legendasdivx", {
        username: credentials.legendasDivxUser,
        password: credentials.legendasDivxPassword,
        skip_wrong_fps: "true",
      });
    }
    if (credentials.legendasNetUser && credentials.legendasNetPassword) {
      addProvider("legendasnet", {
        username: credentials.legendasNetUser,
        password: credentials.legendasNetPassword,
      });
    }

    await request(`${this.baseUrl}/api/system/settings`, {
      method: "POST",
      headers: this.headers(),
      body: providers,
      expected: [200, 204],
    });
  }
}
