import assert from "node:assert/strict";
import {
  accessSync,
  chmodSync,
  constants,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateArrspirePaths } from "../path-validation.mjs";
import type { ArrspirePaths } from "../paths.mjs";

function temporaryPaths(): {
  readonly root: string;
  readonly paths: ArrspirePaths;
} {
  const root = mkdtempSync(join(tmpdir(), "arrspire-paths-"));
  const paths: ArrspirePaths = {
    data: join(root, "data"),
    media: join(root, "media"),
    downloads: join(root, "downloads"),
    containerSocket: "/var/run/docker.sock",
    rootlessPodman: false,
  };
  mkdirSync(paths.data);
  mkdirSync(paths.media);
  mkdirSync(paths.downloads);
  return { root, paths };
}

void test("accepts a bind mount that the host process cannot write", () => {
  const fixture = temporaryPaths();
  try {
    chmodSync(fixture.paths.downloads, 0o555);
    if (process.getuid?.() !== 0) {
      assert.throws(() =>
        accessSync(fixture.paths.downloads, constants.W_OK),
      );
    }
    assert.doesNotThrow(() => validateArrspirePaths(fixture.paths));
  } finally {
    chmodSync(fixture.paths.downloads, 0o755);
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

void test("rejects a bind mount path that is not a directory", () => {
  const fixture = temporaryPaths();
  try {
    rmSync(fixture.paths.downloads, { recursive: true });
    writeFileSync(fixture.paths.downloads, "");
    assert.throws(
      () => validateArrspirePaths(fixture.paths),
      /Downloads path is not a directory/u,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

void test("rejects overlapping bind mount paths", () => {
  const fixture = temporaryPaths();
  try {
    const paths = {
      ...fixture.paths,
      media: join(fixture.paths.data, "media"),
    };
    assert.throws(
      () => validateArrspirePaths(paths),
      /data and media paths must not overlap/u,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

void test("rejects relative bind mount paths", () => {
  const fixture = temporaryPaths();
  try {
    assert.throws(
      () =>
        validateArrspirePaths({
          ...fixture.paths,
          downloads: "downloads",
        }),
      /Downloads path must be absolute/u,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
