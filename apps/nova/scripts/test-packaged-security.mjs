import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const builder = createRequire(require.resolve("electron-builder/package.json"));
const lib = createRequire(builder.resolve("app-builder-lib/package.json"));
const { getCurrentFuseWire, FuseV1Options } = lib("@electron/fuses");
const { extractFile } = lib("@electron/asar");
const packaged = join(nova, "release/win-unpacked");
const wire = await getCurrentFuseWire(join(packaged, "Vestra Nova.exe"));
assert.equal(wire.version, "1");
for (const fuse of [
  "RunAsNode",
  "EnableNodeOptionsEnvironmentVariable",
  "EnableNodeCliInspectArguments",
])
  assert.equal(
    wire[FuseV1Options[fuse]],
    "0".charCodeAt(0),
    `${fuse} must be disabled`,
  );
for (const fuse of [
  "EnableEmbeddedAsarIntegrityValidation",
  "OnlyLoadAppFromAsar",
])
  assert.equal(
    wire[FuseV1Options[fuse]],
    "1".charCodeAt(0),
    `${fuse} must be enabled`,
  );
const archive = join(packaged, "resources/app.asar");
for (const preload of ["preload.js", "preload-overlay.js"])
  assert.ok(
    extractFile(archive, `dist-electron/${preload}`).length > 0,
    `${preload} must be packaged`,
  );
console.log("PASS packaged executable fuses and both sandboxed preloads");
