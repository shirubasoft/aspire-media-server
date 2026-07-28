import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execute = promisify(execFile);
const projectDirectory = process.cwd();

interface RunningAppHost {
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: Promise<void>;
  readonly output: () => string;
}

function startAppHost(environment: NodeJS.ProcessEnv): RunningAppHost {
  const child = spawn("aspire", ["run", "--non-interactive"], {
    cwd: projectDirectory,
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffered = "";
  let ready = false;
  let resolveReady: (() => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const readinessTimeout = setTimeout(() => {
    if (!ready) {
      rejectReady?.(
        new Error(`Aspire did not start within two minutes:\n${buffered}`),
      );
    }
  }, 120_000);
  readinessTimeout.unref();

  const capture = (chunk: Buffer): void => {
    buffered = `${buffered}${chunk.toString("utf8")}`.slice(-80_000);
    if (!ready && buffered.includes("Starting dashboard")) {
      ready = true;
      clearTimeout(readinessTimeout);
      resolveReady?.();
    }
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.once("error", (error) => {
    clearTimeout(readinessTimeout);
    rejectReady?.(error);
  });
  child.once("exit", (code) => {
    if (!ready) {
      clearTimeout(readinessTimeout);
      rejectReady?.(
        new Error(`Aspire exited before startup (code ${String(code)}):\n${buffered}`),
      );
    }
  });

  return {
    child,
    ready: readyPromise,
    output: () => buffered,
  };
}

async function stopAppHost(appHost: RunningAppHost): Promise<void> {
  if (appHost.child.exitCode !== null) {
    return;
  }
  try {
    await execute("aspire", ["stop", "--non-interactive"], {
      cwd: projectDirectory,
      timeout: 60_000,
    });
  } catch {
    // The child process is still terminated below. Preserve the original test
    // result rather than hiding it behind a best-effort shutdown error.
  }
  if (appHost.child.exitCode !== null) {
    return;
  }
  appHost.child.kill("SIGTERM");
  const exited = new Promise<void>((resolve) => {
    appHost.child.once("exit", () => resolve());
  });
  await Promise.race([
    exited,
    delay(15_000).then(() => {
      appHost.child.kill("SIGKILL");
    }),
  ]);
}

async function acceptanceResult(): Promise<{
  readonly state?: string;
  readonly exitCode?: number;
}> {
  const { stdout } = await execute(
    "aspire",
    [
      "describe",
      "acceptance",
      "--format",
      "json",
      "--non-interactive",
    ],
    { cwd: projectDirectory, timeout: 30_000 },
  );
  const document = JSON.parse(stdout) as {
    readonly resources?: Array<{
      readonly state?: string;
      readonly exitCode?: number;
    }>;
  };
  return document.resources?.[0] ?? {};
}

async function runAcceptance(
  environment: NodeJS.ProcessEnv,
  run: "fresh" | "repeat",
): Promise<void> {
  const appHost = startAppHost(environment);
  try {
    await appHost.ready;
    await execute(
      "aspire",
      [
        "wait",
        "acceptance",
        "--status",
        "down",
        "--timeout",
        "900",
        "--non-interactive",
      ],
      { cwd: projectDirectory, timeout: 920_000 },
    );
    const result = await acceptanceResult();
    if (result.exitCode !== 0) {
      const { stdout: logs } = await execute(
        "aspire",
        [
          "logs",
          "acceptance",
          "--tail",
          "120",
          "--format",
          "table",
          "--non-interactive",
        ],
        { cwd: projectDirectory, timeout: 30_000 },
      );
      assert.fail(
        `${run} acceptance exited ${String(result.exitCode)} (${String(result.state)}):\n${logs}\n${appHost.output()}`,
      );
    }
  } finally {
    await stopAppHost(appHost);
  }
}

async function removeTestRoot(root: string): Promise<void> {
  assert.match(root, /[/\\]arrspire-e2e-[^/\\]+$/u);
  try {
    await rm(root, { recursive: true, force: true });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EACCES"
    ) {
      throw error;
    }
    // Rootless Podman can represent an image's internal service user through
    // a subordinate host UID. Widen only this validated temporary tree, then
    // let Node perform the actual cleanup.
    await execute(
      "podman",
      ["unshare", "chmod", "-R", "a+rwx", root],
      { cwd: projectDirectory, timeout: 30_000 },
    );
    await rm(root, { recursive: true, force: true });
  }
}

void test(
  "fresh real stack auto-configures and remains correct after restart",
  { timeout: 2_000_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "arrspire-e2e-"));
    const data = join(root, "data");
    const media = join(root, "media");
    const downloads = join(root, "downloads");
    await Promise.all([
      mkdir(data),
      mkdir(media),
      mkdir(downloads),
    ]);
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ARRSPIRE_E2E: "true",
      ARRSPIRE_DATA_PATH: data,
      ARRSPIRE_MEDIA_PATH: media,
      ARRSPIRE_DOWNLOADS_PATH: downloads,
      NO_COLOR: "1",
    };

    try {
      await runAcceptance(environment, "fresh");
      await runAcceptance(environment, "repeat");
    } finally {
      await removeTestRoot(root);
    }
  },
);
