import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { log } from "./log.js";

const execute = promisify(execFile);

interface JellyfinPlugin {
  readonly name: string;
  readonly directory: string;
  readonly version: string;
  readonly url: string;
  readonly md5: string;
}

const plugins: readonly JellyfinPlugin[] = [
  {
    name: "File Transformation",
    directory: "FileTransformation",
    version: "2.5.11.0",
    url: "https://github.com/IAmParadox27/jellyfin-plugin-file-transformation/releases/download/2.5.11.0/Release-10.11.11.zip",
    md5: "31fcd58d863995c0a3047d2266d72ef6",
  },
  {
    name: "Jellyfin Enhanced",
    directory: "JellyfinEnhanced",
    version: "12.0.0.0",
    url: "https://github.com/n00bcodr/Jellyfin-Enhanced/releases/download/12.0.0.0/Jellyfin.Plugin.JellyfinEnhanced_10.11.0.zip",
    md5: "6b52d47a302c244ff6d256389a055413",
  },
  {
    name: "Intro Skipper",
    directory: "IntroSkipper",
    version: "1.10.11.22",
    url: "https://github.com/intro-skipper/intro-skipper/releases/download/10.11/v1.10.11.22/intro-skipper-v1.10.11.22.zip",
    md5: "7507b1915039c94cf67c450e4612fb37",
  },
  {
    name: "TheTVDB",
    directory: "TheTVDB",
    version: "22.0.0.0",
    url: "https://github.com/jellyfin/jellyfin-plugin-tvdb/releases/download/v22/thetvdb_22.0.0.0.zip",
    md5: "dff31b428c9416d67ac78f515852d2cb",
  },
  {
    name: "Bazarr",
    directory: "Bazarr",
    version: "1.1.2.0",
    url: "https://github.com/enoch85/bazarr-jellyfin/releases/download/v1.1.2/Jellyfin.Plugin.Bazarr.zip",
    md5: "1833bf8bc8bf8b51ad178c30fd2e9147",
  },
];

async function containsDll(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, { recursive: true });
    return entries.some((entry) => entry.toLowerCase().endsWith(".dll"));
  } catch {
    return false;
  }
}

export function obsoleteJellyfinPluginDirectories(
  directory: string,
  version: string,
  entries: readonly string[],
): readonly string[] {
  const prefix = `${directory}_`;
  const target = `${prefix}${version}`;
  return entries.filter(
    (entry) => entry.startsWith(prefix) && entry !== target,
  );
}

async function removeObsoleteVersions(
  root: string,
  plugin: JellyfinPlugin,
): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  const obsolete = new Set(
    obsoleteJellyfinPluginDirectories(
      plugin.directory,
      plugin.version,
      entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    ),
  );
  for (const entry of entries) {
    if (entry.isDirectory() && obsolete.has(entry.name)) {
      await rm(join(root, entry.name), { recursive: true, force: true });
    }
  }
  if (obsolete.size > 0) {
    log.info("Removed superseded Jellyfin plugin versions", {
      plugin: plugin.name,
      removed: obsolete.size,
    });
  }
}

async function installPlugin(
  root: string,
  plugin: JellyfinPlugin,
): Promise<void> {
  const target = join(root, `${plugin.directory}_${plugin.version}`);
  if (await containsDll(target)) {
    await removeObsoleteVersions(root, plugin);
    log.info("Jellyfin plugin already installed", { plugin: plugin.name });
    return;
  }

  // Keep staging on the same mounted filesystem as the destination. That
  // makes the final rename atomic and avoids cross-device failures.
  const temporary = await mkdtemp(join(root, ".arrspire-plugin-"));
  const archive = join(temporary, "plugin.zip");
  const extracted = join(temporary, "extracted");
  try {
    const response = await fetch(plugin.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`download returned HTTP ${response.status}`);
    }
    await writeFile(archive, Buffer.from(await response.arrayBuffer()), {
      mode: 0o600,
    });
    const checksum = createHash("md5")
      .update(await readFile(archive))
      .digest("hex");
    if (checksum !== plugin.md5) {
      throw new Error(`checksum mismatch for ${plugin.name}`);
    }

    await mkdir(extracted, { recursive: true });
    await execute("unzip", ["-q", "-o", archive, "-d", extracted], {
      timeout: 60_000,
    });
    if (!(await containsDll(extracted))) {
      throw new Error(`archive for ${plugin.name} contains no plugin assembly`);
    }
    await rm(target, { recursive: true, force: true });
    await rename(extracted, target);
    await removeObsoleteVersions(root, plugin);
    log.info("Jellyfin plugin installed", {
      plugin: plugin.name,
      version: plugin.version,
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function installJellyfinPlugins(): Promise<void> {
  const root = "/data/jellyfin/plugins";
  await mkdir(root, { recursive: true });
  for (const plugin of plugins) {
    try {
      await installPlugin(root, plugin);
    } catch (error) {
      // Plugin hosts are external. Keep the media stack usable and retry the
      // missing plugin on the next deterministic bootstrap.
      log.warn("Jellyfin plugin installation deferred", {
        plugin: plugin.name,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}
