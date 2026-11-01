import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
await build({
  entryPoints: [resolve(root, "extensions/kisskh/src/source.js")],
  outfile: resolve(root, "extensions/kisskh/index.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2020",
  legalComments: "inline",
});
console.log("Built native KissKH extension.");
