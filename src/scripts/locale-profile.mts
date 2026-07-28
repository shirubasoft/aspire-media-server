import { spawnSync } from "node:child_process";

const profiles = {
  "pt-BR": {
    timezone: "America/Sao_Paulo",
    jellyfinLanguage: "pt-BR",
    subtitleLanguages: "pt-BR",
  },
  neutral: {
    timezone: "UTC",
    jellyfinLanguage: "en-US",
    subtitleLanguages: "en",
  },
} as const;

const name = process.argv[2] as keyof typeof profiles | undefined;
if (name === undefined || !(name in profiles)) {
  throw new Error(
    `Choose a locale profile: ${Object.keys(profiles).join(" or ")}`,
  );
}
const profile = profiles[name];
const settings = {
  timezone: profile.timezone,
  "jellyfin-language": profile.jellyfinLanguage,
  "subtitle-languages": profile.subtitleLanguages,
};

console.table(
  Object.entries(settings).map(([parameter, value]) => ({
    parameter,
    value,
    deploymentEnvironment: `Parameters__${parameter.replaceAll("-", "_")}=${value}`,
  })),
);

if (process.argv.includes("--apply")) {
  for (const [parameter, value] of Object.entries(settings)) {
    const result = spawnSync(
      "aspire",
      ["secret", "set", `Parameters:${parameter}`, value],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`Unable to apply locale parameter ${parameter}`);
    }
  }
  console.log(`Applied the ${name} locale profile to the local Aspire store`);
}
