import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  TdarrClient,
  tdarrMediaLibrary,
} from "../src/tdarr.js";

void test("provisions a safe media library and a health-check worker", async (context) => {
  const requests: Array<{
    readonly path: string;
    readonly body: Record<string, unknown>;
  }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const path = request.url ?? "/";
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body =
        bodyText === ""
          ? {}
          : (JSON.parse(bodyText) as Record<string, unknown>);
      requests.push({ path, body });
      response.setHeader("Content-Type", "application/json");
      if (path === "/api/v2/cruddb") {
        const data = body.data as
          | { readonly mode?: string }
          | undefined;
        response.end(
          data?.mode === "getAll"
            ? JSON.stringify([
                {
                  _id: "unfinished-library",
                  name: "Library Name",
                  folder: "",
                },
              ])
            : JSON.stringify("OK"),
        );
      } else if (path === "/api/v2/get-nodes") {
        response.end(
          JSON.stringify({
            sessionId: {
              nodeName: "InternalNode",
              workerLimits: { healthcheckcpu: 0 },
            },
          }),
        );
      } else if (
        path === "/api/v2/alter-worker-limit" ||
        path === "/api/v2/scan-files"
      ) {
        response.end(JSON.stringify("OK"));
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", resolve),
  );
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  await new TdarrClient(
    `http://127.0.0.1:${String(address.port)}`,
  ).reconcile();

  const crudRequests = requests.filter(
    (request) => request.path === "/api/v2/cruddb",
  );
  assert.equal(crudRequests.length, 3);
  assert.deepEqual(crudRequests[1]?.body, {
    data: {
      collection: "LibrarySettingsJSONDB",
      mode: "insert",
      docID: "arrspire-media",
      obj: tdarrMediaLibrary(),
    },
  });
  assert.deepEqual(crudRequests[2]?.body, {
    data: {
      collection: "LibrarySettingsJSONDB",
      mode: "removeOne",
      docID: "unfinished-library",
    },
  });
  assert.deepEqual(
    requests.find(
      (request) => request.path === "/api/v2/alter-worker-limit",
    )?.body,
    {
      data: {
        nodeID: "sessionId",
        process: "increase",
        workerType: "healthcheckcpu",
      },
    },
  );
  assert.deepEqual(
    requests.find((request) => request.path === "/api/v2/scan-files")?.body,
    {
      data: {
        scanConfig: {
          dbID: "arrspire-media",
          mode: "scanFindNew",
          arrayOrPath: "/media",
        },
      },
    },
  );
  assert.equal(tdarrMediaLibrary().processTranscodes, false);
  assert.equal(tdarrMediaLibrary().processHealthChecks, true);
});
