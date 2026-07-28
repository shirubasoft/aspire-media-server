import assert from "node:assert/strict";

import { aspireDashboardDigest, images } from "../apphost/images.mjs";

const pinnedImage =
  /^(?:[a-z0-9.-]+(?::\d+)?\/)?[a-z0-9._/-]+:[A-Za-z0-9._-]+@sha256:[a-f0-9]{64}$/u;

for (const [name, image] of Object.entries(images)) {
  assert.match(image, pinnedImage, `${name} must use a tag and manifest digest`);
}
assert.match(
  aspireDashboardDigest,
  /^sha256:[a-f0-9]{64}$/u,
  "Aspire dashboard must use a manifest digest",
);
console.log(`Validated ${String(Object.keys(images).length + 1)} image pins`);
