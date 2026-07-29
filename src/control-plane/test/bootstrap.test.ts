import assert from "node:assert/strict";
import test from "node:test";

import { runtimeDirectoryPlan } from "../src/bootstrap.js";

void test("runtime media and download directories belong to the service user", () => {
  assert.deepEqual(runtimeDirectoryPlan(), [
    { path: "/media/movies", uid: 1000, gid: 1000 },
    { path: "/media/tv", uid: 1000, gid: 1000 },
    { path: "/media/music", uid: 1000, gid: 1000 },
    { path: "/downloads", uid: 1000, gid: 1000 },
    { path: "/downloads/incomplete", uid: 1000, gid: 1000 },
    { path: "/downloads/sonarr", uid: 1000, gid: 1000 },
    { path: "/downloads/radarr", uid: 1000, gid: 1000 },
    { path: "/downloads/lidarr", uid: 1000, gid: 1000 },
  ]);
});
