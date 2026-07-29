import assert from "node:assert/strict";
import test from "node:test";

import { obsoleteJellyfinPluginDirectories } from "../src/jellyfin-plugins.js";

void test("removes only superseded versions of the same Jellyfin plugin", () => {
  assert.deepEqual(
    obsoleteJellyfinPluginDirectories("IntroSkipper", "1.10.11.22", [
      "IntroSkipper_1.10.11.19",
      "IntroSkipper_1.10.11.22",
      "IntroSkipperBackup_1.10.11.19",
      "JellyfinEnhanced_12.0.0.0",
    ]),
    ["IntroSkipper_1.10.11.19"],
  );
});
