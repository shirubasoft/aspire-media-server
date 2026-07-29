import assert from "node:assert/strict";
import test from "node:test";

import { runtimeDirectoryPlan } from "../src/bootstrap.js";
import {
  recyclarrConfigOwnership,
  recyclarrConfiguration,
} from "../src/recyclarr.js";

void test("keeps the scheduled Recyclarr runtime writable by its service user", () => {
  assert.ok(
    runtimeDirectoryPlan().some(
      (directory) =>
        directory.path === "/data/recyclarr" &&
        directory.uid === 1000 &&
        directory.gid === 1000,
    ),
  );
  assert.deepEqual(recyclarrConfigOwnership(), {
    path: "/data/recyclarr/recyclarr.yml",
    uid: 1000,
    gid: 1000,
  });
});

void test("uses Recyclarr v8 guide-backed profiles instead of removed includes", () => {
  const configuration = recyclarrConfiguration(
    "http://sonarr:8989",
    "sonarr-key",
    "http://radarr:7878",
    "radarr-key",
  );

  assert.doesNotMatch(configuration, /^\s+include:/mu);
  assert.doesNotMatch(configuration, /replace_existing_custom_formats/u);
  assert.match(
    configuration,
    /trash_id: 72dae194fc92bf828f32cde7744e51a1 # WEB-1080p/u,
  );
  assert.match(
    configuration,
    /trash_id: d1d67249d3890e49bc12e275d989a7e9 # HD Bluray \+ WEB/u,
  );
  assert.match(configuration, /quality_definition:\n      type: series/u);
  assert.match(configuration, /quality_definition:\n      type: movie/u);
});
