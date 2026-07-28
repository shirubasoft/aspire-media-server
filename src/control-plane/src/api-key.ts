import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export async function readArrApiKey(service: string): Promise<string> {
  const path = `/data/${service}/config.xml`;
  const xml = await readFile(path, "utf8");
  const match = /<ApiKey>([^<]+)<\/ApiKey>/u.exec(xml);
  if (!match?.[1]) {
    throw new Error(`No API key found in ${path}`);
  }
  return match[1];
}

export async function readBazarrApiKey(): Promise<string> {
  const path = "/data/bazarr/config/config.yaml";
  let lastError: unknown;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const yaml = await readFile(path, "utf8");
      const match =
        /^auth:\s*\n(?:[ \t]+[^\n]*\n)*?[ \t]+apikey:\s*["']?([^"'#\s]+)/mu.exec(
          yaml,
        );
      if (!match?.[1]) {
        throw new Error(`No auth.apikey found in ${path}`);
      }
      return match[1];
    } catch (error) {
      lastError = error;
      await delay(2_000);
    }
  }
  throw new Error(`Bazarr API key did not become available: ${String(lastError)}`);
}

export async function readJellyseerrApiKey(): Promise<string> {
  const path = "/data/jellyseerr/settings.json";
  const settings = JSON.parse(await readFile(path, "utf8")) as {
    readonly main?: { readonly apiKey?: unknown };
  };
  const apiKey = settings.main?.apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new Error(`No main.apiKey found in ${path}`);
  }
  return apiKey;
}
