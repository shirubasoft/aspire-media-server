import { spawn } from "node:child_process";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  arrspireOperatorConfigPath,
  resolveArrspirePaths,
} from "../apphost/paths.mjs";
import {
  operatorConfig,
  setupParameters,
  type SetupValues,
  validateSetupValues,
} from "./setup-support.mjs";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nonInteractive = process.argv.includes("--non-interactive");

async function commandOutput(
  command: string,
  args: readonly string[],
): Promise<string> {
  return await new Promise<string>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: sourceRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(
        new Error(
          Buffer.concat(stderr).toString("utf8").trim() ||
            `${command} exited with ${String(code)}`,
        ),
      );
    });
  });
}

async function existingParameters(): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(
      await commandOutput("aspire", [
        "secret",
        "list",
        "--format",
        "Json",
        "--non-interactive",
        "--nologo",
      ]),
    ) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          (entry): entry is [string, string] =>
            entry[0].startsWith("Parameters:") && typeof entry[1] === "string",
        )
        .map(([name, value]) => [name.slice("Parameters:".length), value]),
    );
  } catch {
    return {};
  }
}

function environmentParameter(name: string): string | undefined {
  return process.env[`Parameters__${name.replaceAll("-", "_")}`];
}

async function question(label: string, fallback: string): Promise<string> {
  const prompt = fallback ? `${label} [${fallback}]: ` : `${label}: `;
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = (await readline.question(prompt)).trim();
    return answer || fallback;
  } finally {
    readline.close();
  }
}

async function confirm(label: string, fallback = true): Promise<boolean> {
  const answer = (
    await question(label, fallback ? "Y/n" : "y/N")
  ).toLowerCase();
  return fallback
    ? answer !== "n" && answer !== "no"
    : answer === "y" || answer === "yes";
}

async function secretQuestion(
  label: string,
  existing: string | undefined,
): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      `${label} requires a terminal; use --non-interactive with protected Parameters__* environment variables`,
    );
  }
  const suffix = existing ? " [Enter keeps existing]: " : ": ";
  process.stdout.write(`${label}${suffix}`);
  const input = process.stdin;
  input.setRawMode(true);
  input.resume();
  let value = "";
  return await new Promise<string>((resolvePromise, reject) => {
    const finish = (error?: Error): void => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (error !== undefined) {
        reject(error);
      } else {
        resolvePromise(value || existing || "");
      }
    };
    const onData = (chunk: Buffer): void => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          finish(new Error("Setup cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (character >= " ") {
          value += character;
          process.stdout.write("*");
        }
      }
    };
    input.on("data", onData);
  });
}

async function setParameter(name: string, value: string): Promise<void> {
  await commandOutput("aspire", [
    "secret",
    "set",
    `Parameters:${name}`,
    value,
    "--non-interactive",
    "--nologo",
  ]);
}

async function writeOperatorConfig(values: SetupValues): Promise<string> {
  const path = arrspireOperatorConfigPath(sourceRoot);
  const temporary = `${path}.${String(process.pid)}.tmp`;
  const config = operatorConfig(values);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  await Promise.all(
    Object.values(config.paths).map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );
  await writeFile(temporary, `${JSON.stringify(config, undefined, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return path;
}

async function main(): Promise<void> {
  const existing = await existingParameters();
  const paths = resolveArrspirePaths(sourceRoot);
  const current = (name: string, fallback: string): string =>
    environmentParameter(name) ?? existing[name] ?? fallback;

  let values: SetupValues;
  if (nonInteractive) {
    values = {
      vpnProvider: current("vpn-provider", "protonvpn"),
      vpnCountries: current("vpn-countries", "Netherlands"),
      vpnWireguardKey: current("vpn-wireguard-key", ""),
      timezone: current(
        "timezone",
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      ),
      jellyfinLanguage: current("jellyfin-language", "pt-BR"),
      subtitleLanguages: current("subtitle-languages", "pt-BR"),
      traefikDomain: current("traefik-domain", "192.168.0.15.nip.io"),
      traefikTlsMode: current("traefik-tls-mode", "local"),
      traefikAcmeEmail: current("traefik-acme-email", ""),
      cloudflareDnsApiToken: current("cloudflare-dns-api-token", ""),
      dataPath: paths.data,
      mediaPath: paths.media,
      downloadsPath: paths.downloads,
      ntfyEndpoint: current("ntfy-endpoint", "https://ntfy.sh"),
      ntfyTopic: current("ntfy-topic", ""),
      ntfyToken: current("ntfy-token", ""),
    };
  } else {
    console.log("Arrspire guided setup");
    console.log(
      "Press Enter to accept a shown default. Secret input is masked.\n",
    );
    const vpnProvider = await question(
      "Gluetun VPN provider",
      current("vpn-provider", "protonvpn"),
    );
    const vpnCountries = await question(
      "VPN exit countries (comma-separated)",
      current("vpn-countries", "Netherlands"),
    );
    const vpnWireguardKey = await secretQuestion(
      "WireGuard private key",
      current("vpn-wireguard-key", "") || undefined,
    );
    const timezone = await question(
      "IANA timezone",
      current(
        "timezone",
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      ),
    );
    const jellyfinLanguage = await question(
      "Jellyfin language",
      current("jellyfin-language", "pt-BR"),
    );
    const subtitleLanguages = await question(
      "Subtitle languages (comma-separated)",
      current("subtitle-languages", "pt-BR"),
    );
    const traefikDomain = await question(
      "Private ingress domain",
      current("traefik-domain", "192.168.0.15.nip.io"),
    );
    const traefikTlsMode = await question(
      "TLS mode (local or cloudflare-acme)",
      current("traefik-tls-mode", "local"),
    );
    const traefikAcmeEmail =
      traefikTlsMode === "cloudflare-acme"
        ? await question(
            "Let's Encrypt email",
            current("traefik-acme-email", ""),
          )
        : current("traefik-acme-email", "");
    const cloudflareDnsApiToken =
      traefikTlsMode === "cloudflare-acme"
        ? await secretQuestion(
            "Cloudflare DNS API token",
            current("cloudflare-dns-api-token", "") || undefined,
          )
        : current("cloudflare-dns-api-token", "");
    const dataPath = await question("Persistent data path", paths.data);
    const mediaPath = await question("Media path", paths.media);
    const downloadsPath = await question("Downloads path", paths.downloads);
    const notifications = await confirm(
      "Enable ntfy push notifications?",
      Boolean(current("ntfy-topic", "")),
    );
    const ntfyEndpoint = notifications
      ? await question(
          "ntfy server URL",
          current("ntfy-endpoint", "https://ntfy.sh"),
        )
      : current("ntfy-endpoint", "https://ntfy.sh");
    const ntfyTopic = notifications
      ? await secretQuestion(
          "Private ntfy topic",
          current("ntfy-topic", "") || undefined,
        )
      : "";
    const ntfyToken = notifications
      ? await secretQuestion(
          "ntfy access token (optional)",
          current("ntfy-token", "") || undefined,
        )
      : "";
    values = {
      vpnProvider,
      vpnCountries,
      vpnWireguardKey,
      timezone,
      jellyfinLanguage,
      subtitleLanguages,
      traefikDomain,
      traefikTlsMode,
      traefikAcmeEmail,
      cloudflareDnsApiToken,
      dataPath,
      mediaPath,
      downloadsPath,
      ntfyEndpoint,
      ntfyTopic,
      ntfyToken,
    };
  }

  validateSetupValues(values);
  console.table([
    { setting: "VPN", value: `${values.vpnProvider} / ${values.vpnCountries}` },
    {
      setting: "Locale",
      value: `${values.timezone} / ${values.jellyfinLanguage}`,
    },
    {
      setting: "Ingress",
      value: `${values.traefikDomain} (${values.traefikTlsMode})`,
    },
    { setting: "Data", value: resolve(values.dataPath) },
    { setting: "Media", value: resolve(values.mediaPath) },
    { setting: "Downloads", value: resolve(values.downloadsPath) },
    {
      setting: "Notifications",
      value: values.ntfyTopic ? "enabled" : "disabled",
    },
  ]);

  if (!nonInteractive && !(await confirm("Save this configuration?"))) {
    throw new Error("Setup cancelled without making changes");
  }

  const parameters = setupParameters(values);
  for (const [name, value] of Object.entries(parameters)) {
    await setParameter(name, value);
  }
  const configPath = await writeOperatorConfig(values);
  console.log(`Saved local paths to ${configPath}`);
  console.log("Saved parameters to the local Aspire secret store.");
  console.log("Next: run npm run doctor, then npm run dev or npm run deploy.");
}

try {
  await main();
} catch (error) {
  console.error(
    `Setup could not continue: ${error instanceof Error ? error.message : String(error)}`,
  );
  console.error("No path configuration was written.");
  process.exitCode = 1;
}
