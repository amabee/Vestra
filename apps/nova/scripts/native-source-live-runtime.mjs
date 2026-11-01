import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
export const sourceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Real isolate + granted broker + guarded HTTP, without installing into a user profile. */
export async function loadNativeSource(name) {
  if (!/^[a-z][a-z0-9-]+$/.test(name)) throw Error("Invalid source directory");
  const parent = resolve(sourceRoot, "apps/nova/node_modules");
  const scratch = await mkdtemp(join(parent, ".native-source-live-"));
  assert(resolve(scratch).startsWith(parent + sep));
  let loaded;
  const dispose = async () => {
    loaded?.dispose();
    await rm(scratch, { recursive: true, force: true });
  };
  try {
    const hostRequire = createRequire(
      join(sourceRoot, "packages/extension-host/package.json"),
    );
    await build({
      stdin: {
        contents: `export {createQuickJSRuntime} from './packages/extension-host/src/runtime/quickjs';export {createStreamSourceProvider} from './packages/extension-host/src/provider';export {createBrokeredFetch} from './packages/extension-host/src/net';export {parseManifest} from './packages/extension-host/src/manifest';export {safeFetch} from './apps/nova/electron/safe-fetch';`,
        resolveDir: sourceRoot,
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: join(scratch, "runtime.cjs"),
      plugins: [
        {
          name: "real-quickjs",
          setup(build) {
            build.onResolve({ filter: /^quickjs-emscripten$/ }, () => ({
              path: hostRequire.resolve("quickjs-emscripten"),
              external: true,
            }));
          },
        },
      ],
    });
    const {
      createQuickJSRuntime,
      createStreamSourceProvider,
      createBrokeredFetch,
      parseManifest,
      safeFetch,
    } = createRequire(import.meta.url)(join(scratch, "runtime.cjs"));
    const parsed = parseManifest(
      JSON.parse(
        await readFile(
          join(sourceRoot, "extensions", name, "manifest.json"),
          "utf8",
        ),
      ),
    );
    assert.deepEqual(parsed.errors, []);
    const manifest = parsed.manifest;
    const fetcher = createBrokeredFetch(
      {
        extensionId: manifest.id,
        granted: manifest.permissions,
        allowedHosts: manifest.hosts,
        grantedForVersion: manifest.version,
        grantedAt: new Date().toISOString(),
      },
      { request: safeFetch },
    );
    loaded = await createQuickJSRuntime().load({
      extensionId: manifest.id,
      source: await readFile(
        join(sourceRoot, "extensions", name, "index.js"),
        "utf8",
      ),
      bridge: { extensionId: manifest.id, fetch: fetcher, log() {} },
    });
    const source = createStreamSourceProvider({
      extensionId: manifest.id,
      name: manifest.name,
      kinds: manifest.kinds,
      browseCategories: manifest.discovery?.categories,
      methods: await loaded.listMethods(AbortSignal.timeout(10000)),
      call: (method, args, signal) => loaded.call(method, [...args], signal),
    });
    return { source, manifest, safeFetch, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
