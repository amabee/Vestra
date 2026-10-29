// @ts-check
import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bundles Nova's Electron sources.
 *
 * `tsc` alone was enough while `electron/` imported nothing but Node and
 * Electron. It stops being enough the moment Nova uses a workspace package:
 * those ship raw TypeScript with extensionless imports, so `tsc` would emit a
 * `require("@vestra/extension-host/quickjs")` pointing at a `.ts` file Node
 * cannot execute. Bundling resolves and compiles those in.
 *
 * esbuild does not typecheck, so `pnpm --filter @vestra/nova typecheck` still
 * runs `tsc --noEmit` and remains the gate.
 *
 * Three targets, three environments. They are built separately on purpose:
 * bundling them together meant the `__filename` shim below leaked into the
 * preload, where it does not exist, and the bridge failed to load with the
 * window still rendering — a silent break.
 */

const novaRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repoRoot = path.resolve(novaRoot, "../..");
const outDir = path.join(novaRoot, "dist-electron");

const shared = {
  absWorkingDir: novaRoot,
  outdir: "dist-electron",
  bundle: true,
  sourcemap: true,
  // Readable on purpose: this is a local app bundle, and a legible stack trace
  // is worth more than the saved bytes.
  minify: false,
  logLevel: "info",
};

// Start clean. Stale per-file output from the old `tsc` build would otherwise
// be packaged alongside the bundles.
await rm(outDir, { recursive: true, force: true });

/**
 * Main process and extension worker — full Node.
 *
 * quickjs-emscripten locates its WASM with `import.meta.url`, which becomes
 * `undefined` once esbuild rewrites ESM to CJS; the module then fails with
 * "filename must be a file URL". Pointing it at the bundle's own location makes
 * the lookup land in `dist-electron`, where the `.wasm` is copied below.
 */
await build({
  ...shared,
  entryPoints: ["electron/main.ts", "electron/extension-worker.ts"],
  platform: "node",
  // Electron's main process is CommonJS; nova/package.json sets no "type".
  format: "cjs",
  // Electron 43 ships Node 22.
  target: "node22",
  // `@ffprobe-installer/ffprobe` derives its binary path from `__dirname`.
  // Bundling it would rebase that onto `dist-electron` and point at nothing,
  // so it stays external and is resolved from node_modules at runtime — and is
  // absent from the packaged app, where PATH or an explicit setting takes over.
  external: ["electron", "@ffprobe-installer/ffprobe"],
  define: { "import.meta.url": "__vestraModuleUrl" },
  banner: {
    js: "const __vestraModuleUrl = require('node:url').pathToFileURL(__filename).href;",
  },
});

/**
 * Preload — sandboxed.
 *
 * Runs before the sandbox lifts and has no `__filename`, no `import.meta`, and
 * only a small allow-listed slice of Node. It gets none of the shims above.
 */
await build({
  ...shared,
  entryPoints: ["electron/preload.ts"],
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
});

/**
 * Renderer.
 *
 * Built by Vite, not here — see `renderer/vite.config.ts`. It needs JSX, CSS
 * and asset handling that esbuild alone would not give, and it outputs to
 * `dist-renderer` rather than `dist-electron`.
 */

/**
 * Copy the QuickJS WASM next to the bundle.
 *
 * Emscripten resolves it relative to the module that loads it, so it has to sit
 * beside `extension-worker.js`. Keeping it inside `dist-electron` means
 * electron-builder already ships it — no node_modules in the packaged app, and
 * no pnpm symlink farm to untangle.
 */
const requireFromHost = createRequire(
  path.join(repoRoot, "packages/extension-host/package.json"),
);

const quickjsDir = path.dirname(
  requireFromHost.resolve("quickjs-emscripten/package.json"),
);
const variantDir = path.dirname(
  createRequire(path.join(quickjsDir, "package.json")).resolve(
    "@jitl/quickjs-wasmfile-release-sync/package.json",
  ),
);

await mkdir(outDir, { recursive: true });
await copyFile(
  path.join(variantDir, "dist/emscripten-module.wasm"),
  path.join(outDir, "emscripten-module.wasm"),
);

console.info("[build-electron] copied emscripten-module.wasm");

// The compiler is a standalone CJS asset; installed apps have no node_modules.
const requireFromNova = createRequire(path.join(novaRoot, "package.json"));
const compiler = requireFromNova.resolve("typescript");
await copyFile(compiler, path.join(outDir, "provider-typescript.cjs"));
await copyFile(
  path.join(path.dirname(compiler), "../LICENSE.txt"),
  path.join(outDir, "typescript-LICENSE.txt"),
);
console.info("[build-electron] copied provider compiler and license");
