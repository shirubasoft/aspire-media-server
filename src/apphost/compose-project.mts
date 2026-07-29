import { resolve } from "node:path";

interface ComposeProject {
  readonly Name?: unknown;
  readonly ConfigFiles?: unknown;
}

function configFiles(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" ? value.split(",") : [];
}

export function selectComposeProjectName(
  composeListJson: string,
  composeFile: string,
): string | undefined {
  const documentStart = composeListJson.indexOf("[");
  if (documentStart < 0) {
    return undefined;
  }
  const document = JSON.parse(
    composeListJson.slice(documentStart),
  ) as unknown;
  if (!Array.isArray(document)) {
    return undefined;
  }
  const target = resolve(composeFile);
  const matches = document
    .filter((item): item is ComposeProject =>
      typeof item === "object" && item !== null
    )
    .filter((item) =>
      configFiles(item.ConfigFiles).some((file) => resolve(file) === target)
    )
    .map((item) => item.Name)
    .filter((name): name is string => typeof name === "string" && name !== "");
  const unique = [...new Set(matches)];
  if (unique.length > 1) {
    throw new Error(
      `Multiple Compose projects reference ${composeFile}: ${unique.join(", ")}`,
    );
  }
  return unique[0];
}
