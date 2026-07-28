import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readIfExists(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function writeIfChanged(
  path: string,
  content: string,
  mode = 0o600,
): Promise<boolean> {
  const existing = await readIfExists(path);
  if (existing === content) {
    return false;
  }
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, { encoding: "utf8", mode });
  await chmod(temporaryPath, mode);
  await rename(temporaryPath, path);
  return true;
}

export async function writeOnce(
  path: string,
  content: string,
  mode = 0o600,
): Promise<boolean> {
  if ((await readIfExists(path)) !== undefined) {
    return false;
  }
  return writeIfChanged(path, content, mode);
}
