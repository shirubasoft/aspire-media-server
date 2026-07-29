import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

import type { ArrspirePaths } from "./paths.mjs";

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function prepareBindMountDirectory(name: string, path: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${name} path must be absolute: ${path}`);
  }
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory()) {
    throw new Error(`${name} path is not a directory: ${canonical}`);
  }
  return canonical;
}

export function validateArrspirePaths(paths: ArrspirePaths): void {
  const directories = {
    data: prepareBindMountDirectory("Data", paths.data),
    media: prepareBindMountDirectory("Media", paths.media),
    downloads: prepareBindMountDirectory("Downloads", paths.downloads),
  };
  const entries = Object.entries(directories);
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    if (current === undefined) {
      continue;
    }
    for (const candidate of entries.slice(index + 1)) {
      if (
        contains(current[1], candidate[1]) ||
        contains(candidate[1], current[1])
      ) {
        throw new Error(
          `${current[0]} and ${candidate[0]} paths must not overlap: ${current[1]} / ${candidate[1]}`,
        );
      }
    }
  }
}
