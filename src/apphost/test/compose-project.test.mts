import assert from "node:assert/strict";
import test from "node:test";

import { selectComposeProjectName } from "../compose-project.mjs";

void test("selects Aspire's generated Compose project by config file", () => {
  const composeFile =
    "/workspace/arrspire/src/aspire-output/docker-compose.yaml";
  const projects = JSON.stringify([
    {
      Name: "unrelated",
      Status: "running(2)",
      ConfigFiles: "/workspace/other/docker-compose.yaml",
    },
    {
      Name: "aspire-arrspire-bea4d757",
      Status: "running(18)",
      ConfigFiles: composeFile,
    },
  ]);
  assert.equal(
    selectComposeProjectName(projects, composeFile),
    "aspire-arrspire-bea4d757",
  );
});

void test("handles Compose projects with multiple config files", () => {
  const composeFile = "/workspace/arrspire/docker-compose.yaml";
  const projects = JSON.stringify([
    {
      Name: "arrspire",
      Status: "running(18)",
      ConfigFiles: `/workspace/base.yaml,${composeFile}`,
    },
  ]);
  assert.equal(selectComposeProjectName(projects, composeFile), "arrspire");
});

void test("returns undefined when no running project owns the artifact", () => {
  assert.equal(
    selectComposeProjectName(
      JSON.stringify([
        {
          Name: "other",
          Status: "running(1)",
          ConfigFiles: "/workspace/other.yaml",
        },
      ]),
      "/workspace/arrspire/docker-compose.yaml",
    ),
    undefined,
  );
});
