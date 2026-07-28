import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function waitFor(
  operation: () => Promise<boolean>,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (await operation()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(message);
}

void test(
  "VPN lifecycle watchdog cleans exact containers after abrupt shutdown",
  { timeout: 15_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "arrspire-vpn-lifecycle-"));
    const logPath = join(root, "runtime.log");
    const fakeRuntime = join(root, "fake-runtime.mjs");
    await writeFile(
      fakeRuntime,
      `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const [action, ...args] = process.argv.slice(2);
const log = process.env.FAKE_RUNTIME_LOG;
appendFileSync(log, [action, ...args].join(" ") + "\\n");
if (action === "run") {
  const nameIndex = args.indexOf("--name");
  const name = args[nameIndex + 1];
  const timer = setInterval(() => {
    if (readFileSync(log, "utf8").includes("rm --force " + name)) {
      clearInterval(timer);
      process.exit(0);
    }
  }, 25);
}
`,
      "utf8",
    );
    await chmod(fakeRuntime, 0o700);
    const appHost = spawn(process.execPath, [
      "-e",
      "setInterval(() => {}, 1000)",
    ]);
    assert.ok(appHost.pid);
    const wrapper = spawn(
      process.execPath,
      [
        "scripts/run-vpn-container.mts",
        fakeRuntime,
        "arrspire-test-qbittorrent",
        "arrspire-test-gluetun",
        String(appHost.pid),
        "run",
        "--name",
        "arrspire-test-qbittorrent",
        "example.invalid/test:latest",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, FAKE_RUNTIME_LOG: logPath },
        stdio: "ignore",
      },
    );
    try {
      await waitFor(
        async () =>
          (await readFile(logPath, "utf8").catch(() => "")).includes("run "),
        "fake container was not launched",
      );
      wrapper.kill("SIGKILL");
      await waitFor(
        async () =>
          (await readFile(logPath, "utf8")).includes(
            "rm --force arrspire-test-qbittorrent",
          ),
        "abrupt wrapper shutdown did not remove qBittorrent",
      );
      assert.doesNotMatch(
        await readFile(logPath, "utf8"),
        /rm --force arrspire-test-gluetun/u,
      );

      appHost.kill("SIGKILL");
      await waitFor(
        async () =>
          (await readFile(logPath, "utf8")).includes(
            "rm --force arrspire-test-gluetun",
          ),
        "abrupt AppHost shutdown did not remove Gluetun",
      );
    } finally {
      wrapper.kill("SIGKILL");
      appHost.kill("SIGKILL");
      await rm(root, { recursive: true, force: true });
    }
  },
);
