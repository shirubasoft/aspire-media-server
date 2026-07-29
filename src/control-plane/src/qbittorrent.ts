import { form, json, request } from "./http.js";
import { log } from "./log.js";

type Preferences = Readonly<Record<string, unknown>>;
type Categories = Readonly<Record<string, { readonly savePath?: string }>>;

export class QBittorrentClient {
  private cookie = "";

  constructor(
    private readonly baseUrl: string,
    private readonly username: string,
    private readonly password: string,
  ) {}

  async reconcile(): Promise<void> {
    await this.login();
    await this.reconcilePreferences();
    await this.reconcileCategories();
  }

  private async login(): Promise<void> {
    const response = await request(`${this.baseUrl}/api/v2/auth/login`, {
      method: "POST",
      body: form({
        username: this.username,
        password: this.password,
      }),
      expected: [200, 204],
    });
    const result = await response.text();
    if (response.status === 200 && result.trim() !== "Ok.") {
      throw new Error(`qBittorrent rejected authentication: ${result}`);
    }
    const setCookie = response.headers.get("set-cookie") ?? "";
    const sid = /^(?:(?:QBT_)?SID(?:_[^=;]+)?=[^;]+)/u.exec(setCookie)?.[0];
    if (!sid) {
      throw new Error("qBittorrent did not return a session cookie");
    }
    this.cookie = sid;
  }

  private headers(): Readonly<Record<string, string>> {
    return {
      Cookie: this.cookie,
      Referer: `${this.baseUrl}/`,
      Origin: this.baseUrl,
    };
  }

  private async reconcilePreferences(): Promise<void> {
    const current = await json<Preferences>(
      `${this.baseUrl}/api/v2/app/preferences`,
      { headers: this.headers() },
    );
    const desired: Readonly<Record<string, unknown>> = {
      max_connec: 500,
      max_connec_per_torrent: 100,
      max_uploads: 50,
      max_uploads_per_torrent: 10,
      max_ratio_enabled: false,
      max_seeding_time_enabled: false,
      max_ratio_act: 0,
      dht: true,
      pex: true,
      lsd: false,
      encryption: 1,
      max_active_downloads: 5,
      max_active_uploads: 10,
      max_active_torrents: 15,
      dont_count_slow_torrents: true,
      slow_torrent_dl_rate_threshold: 10,
      slow_torrent_ul_rate_threshold: 10,
      auto_tmm_enabled: true,
      preallocate_all: false,
      incomplete_files_ext: false,
      anonymous_mode: false,
      add_trackers_enabled: false,
      queueing_enabled: true,
      save_path: "/downloads",
      temp_path_enabled: true,
      temp_path: "/downloads/incomplete",
      // qBittorrent 5.2 exposes this enum as a string. Numeric value 3 was
      // accepted by older releases but is now normalized back to "None".
      // qBittorrent already shares Gluetun's network namespace. An additional
      // HTTP proxy prevents UDP trackers and direct peer traffic from working.
      proxy_type: "None",
      proxy_auth_enabled: false,
      proxy_peer_connections: false,
      proxy_hostname_lookup: false,
      proxy_bittorrent: false,
      proxy_misc: false,
      proxy_rss: false,
    };

    const changes = Object.fromEntries(
      Object.entries(desired).filter(([key, value]) => current[key] !== value),
    );
    if (Object.keys(changes).length === 0) {
      log.info("qBittorrent preferences already match");
      return;
    }
    await request(`${this.baseUrl}/api/v2/app/setPreferences`, {
      method: "POST",
      headers: this.headers(),
      body: form({ json: JSON.stringify(changes) }),
    });
    log.info("qBittorrent preferences reconciled", {
      changed: Object.keys(changes).length,
    });
  }

  private async reconcileCategories(): Promise<void> {
    const desired = {
      sonarr: "/tv",
      radarr: "/movies",
      lidarr: "/music",
    } as const;
    const current = await json<Categories>(
      `${this.baseUrl}/api/v2/torrents/categories`,
      { headers: this.headers() },
    );
    for (const [category, savePath] of Object.entries(desired)) {
      if (current[category]?.savePath === savePath) {
        continue;
      }
      const endpoint =
        current[category] === undefined ? "createCategory" : "editCategory";
      await request(`${this.baseUrl}/api/v2/torrents/${endpoint}`, {
        method: "POST",
        headers: this.headers(),
        body: form({ category, savePath }),
      });
      log.info("qBittorrent category reconciled", { category, savePath });
    }
  }
}
