import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifySnapshot } from "./foundry-snapshot.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const resources = join(root, "apps/nova/release/win-unpacked/resources");
const expected = JSON.parse(
  await readFile(join(root, "extensions.snapshot.json"), "utf8"),
);
const packaged = await verifySnapshot(resources);
assert.deepEqual(
  packaged,
  expected,
  "Packaged Foundry snapshot must match the reviewed source inventory and hashes.",
);
console.log(
  `PASS packaged Foundry inventory: ${packaged.files.length} reviewed source, logo and registry files`,
);
