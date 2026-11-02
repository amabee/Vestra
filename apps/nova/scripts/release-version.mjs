import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { inc, valid } = createRequire(
  require.resolve("electron-updater/package.json"),
)("semver");
const file = new URL("../package.json", import.meta.url);
const manifest = JSON.parse(await readFile(file, "utf8"));
const bump = process.argv[2];
if (!["patch", "minor", "major"].includes(bump))
  throw Error(
    "Choose patch, minor or major. Example: pnpm release:version minor",
  );
if (!valid(manifest.version)) throw Error("Current app version is invalid.");
manifest.version = inc(manifest.version, bump);
await writeFile(file, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `Nova version: ${manifest.version}. Commit the change, then create tag v${manifest.version} when ready to build a draft release.`,
);
