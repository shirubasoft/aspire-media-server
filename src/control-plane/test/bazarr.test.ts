import assert from "node:assert/strict";
import test from "node:test";

import { bazarrLanguageCode } from "../src/bazarr.js";

void test("maps Brazilian Portuguese to Bazarr's regional language code", () => {
  assert.equal(bazarrLanguageCode("pt-BR"), "pb");
  assert.equal(bazarrLanguageCode("PT-br"), "pb");
  assert.equal(bazarrLanguageCode("en"), "en");
});
