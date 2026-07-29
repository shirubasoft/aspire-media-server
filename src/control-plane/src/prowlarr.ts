import { json } from "./http.js";
import { log } from "./log.js";

type JsonObject = Record<string, unknown>;

interface Field {
  readonly name?: string;
  value?: unknown;
}

interface ProwlarrEntity extends JsonObject {
  readonly id?: number;
  name?: string;
  readonly implementation?: string;
  readonly fields?: Field[];
}

interface Application {
  readonly name: "Sonarr" | "Radarr" | "Lidarr";
  readonly url: string;
  readonly apiKey: string;
  readonly categories: readonly number[];
}

export interface ProwlarrOptionalIntegration {
  readonly name: string;
  readonly status: "ready" | "skipped" | "failed";
  readonly reason?: string;
}

export class ProwlarrClient {
  private readonly apiBase: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
  ) {
    this.apiBase = `${baseUrl}/api/v1`;
  }

  async reconcile(
    proxyUrl: string,
    applications: readonly Application[],
  ): Promise<readonly ProwlarrOptionalIntegration[]> {
    await this.reconcileProxy(proxyUrl);
    await this.disableRetiredIndexers(["LimeTorrents"]);
    for (const application of applications) {
      await this.reconcileApplication(application);
    }
    return this.reconcilePublicIndexers();
  }

  private headers(): Readonly<Record<string, string>> {
    return {
      "Content-Type": "application/json",
      "X-Api-Key": this.apiKey,
    };
  }

  private async get<T>(path: string): Promise<T> {
    return json<T>(`${this.apiBase}${path}`, { headers: this.headers() });
  }

  private async send<T>(
    method: "POST" | "PUT",
    path: string,
    body: unknown,
  ): Promise<T> {
    return json<T>(`${this.apiBase}${path}`, {
      method,
      headers: this.headers(),
      body: JSON.stringify(body),
    });
  }

  private async reconcileProxy(proxyUrl: string): Promise<void> {
    const proxy = new URL(proxyUrl);
    const config = await this.get<ProwlarrEntity>("/config/host");
    const desired: Readonly<Record<string, unknown>> = {
      proxyEnabled: true,
      proxyType: "http",
      proxyHostname: proxy.hostname,
      proxyPort: Number(proxy.port || 8888),
      proxyUsername: "",
      proxyPassword: "",
      proxyBypassFilter: "",
      proxyBypassLocalAddresses: true,
    };
    if (
      Object.entries(desired).some(([key, value]) => config[key] !== value)
    ) {
      Object.assign(config, desired);
      await this.send("PUT", "/config/host", config);
      log.info("Prowlarr VPN proxy reconciled");
    }
  }

  private async reconcileApplication(application: Application): Promise<void> {
    const existing = await this.get<ProwlarrEntity[]>("/applications");
    const current = existing.find(
      (candidate) => candidate.implementation === application.name,
    );
    const schemas = await this.get<ProwlarrEntity[]>("/applications/schema");
    const model = structuredClone(
      current ??
        schemas.find(
          (candidate) => candidate.implementation === application.name,
        ),
    );
    if (!model) {
      throw new Error(
        `Prowlarr has no application schema for ${application.name}`,
      );
    }

    model.name = application.name;
    model.syncLevel = "fullSync";
    const values: Readonly<Record<string, unknown>> = {
      prowlarrUrl: this.apiBase.replace(/\/api\/v1$/u, ""),
      baseUrl: application.url,
      apiKey: application.apiKey,
      syncCategories: application.categories,
      animeSyncCategories:
        application.name === "Sonarr" ? [5070] : undefined,
      syncAnimeStandardFormatSearch:
        application.name === "Sonarr" ? false : undefined,
    };
    for (const field of model.fields ?? []) {
      if (field.name && values[field.name] !== undefined) {
        field.value = values[field.name];
      }
    }

    if (current?.id) {
      await this.send("PUT", `/applications/${String(current.id)}`, model);
    } else {
      await this.send("POST", "/applications", model);
    }
    log.info("Prowlarr application reconciled", {
      application: application.name,
    });
  }

  private async disableRetiredIndexers(
    names: readonly string[],
  ): Promise<void> {
    const existing = await this.get<ProwlarrEntity[]>("/indexer");
    for (const name of names) {
      const current = existing.find(
        (indexer) => indexer.name?.toLowerCase() === name.toLowerCase(),
      );
      if (!current?.id || current.enable === false) {
        continue;
      }
      current.enable = false;
      current.enableAutomaticSearch = false;
      current.enableInteractiveSearch = false;
      await this.send(
        "PUT",
        `/indexer/${String(current.id)}?forceSave=true`,
        current,
      );
      log.info("Prowlarr retired indexer disabled", { indexer: name });
    }
  }

  private async reconcilePublicIndexers(): Promise<
    readonly ProwlarrOptionalIntegration[]
  > {
    const desired: Readonly<Record<string, number>> = {
      "Nyaa.si": 5,
      EZTV: 25,
      Knaben: 20,
      YTS: 25,
    };
    const existing = await this.get<ProwlarrEntity[]>("/indexer");
    const schemas = await this.get<ProwlarrEntity[]>("/indexer/schema");
    const results: ProwlarrOptionalIntegration[] = [];

    for (const [name, priority] of Object.entries(desired)) {
      const current = existing.find(
        (indexer) => indexer.name?.toLowerCase() === name.toLowerCase(),
      );
      const model = structuredClone(
        current ??
          schemas.find(
            (schema) => schema.name?.toLowerCase() === name.toLowerCase(),
          ),
      );
      if (!model) {
        log.warn("Prowlarr indexer schema is unavailable", { indexer: name });
        results.push({
          name,
          status: "skipped",
          reason: "Prowlarr indexer schema is unavailable",
        });
        continue;
      }
      model.enable = true;
      model.appProfileId = 1;
      model.priority = priority;
      try {
        if (current?.id) {
          await this.send("PUT", `/indexer/${String(current.id)}`, model);
        } else {
          await this.send("POST", "/indexer", model);
        }
        log.info("Prowlarr indexer reconciled", { indexer: name, priority });
        results.push({ name, status: "ready" });
      } catch (error) {
        // Public trackers routinely add bot protection or go offline. Their
        // temporary availability must not make the rest of Arrspire flaky.
        log.warn("Prowlarr indexer is temporarily unavailable", {
          indexer: name,
          error: error instanceof Error ? error.message.slice(0, 240) : "unknown",
        });
        results.push({
          name,
          status: "failed",
          reason:
            error instanceof Error
              ? error.message.slice(0, 240)
              : "Temporarily unavailable",
        });
      }
    }
    return results;
  }
}
