import { accessSync, constants, mkdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { ArrspirePaths } from "./paths.mjs";

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function prepareWritableDirectory(name: string, path: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${name} path must be absolute: ${path}`);
  }
  mkdirSync(path, { recursive: true });
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory()) {
    throw new Error(`${name} path is not a directory: ${canonical}`);
  }
  try {
    accessSync(canonical, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(`${name} path must be readable and writable: ${canonical}`);
  }
  return canonical;
}

export function validateArrspirePaths(paths: ArrspirePaths): void {
  const directories = {
    data: prepareWritableDirectory("Data", resolve(paths.data)),
    media: prepareWritableDirectory("Media", resolve(paths.media)),
    downloads: prepareWritableDirectory("Downloads", resolve(paths.downloads)),
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
