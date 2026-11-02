import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const scratch = await mkdtemp(join(tmpdir(), "vestra-tmdb-test-"));
const root = resolve(".");
try {
  await build({
    stdin: {
      contents: `export * from './apps/nova/electron/tmdb-settings'; export * from './apps/nova/renderer/src/lib/extension-category'; export { getServerEnv } from './packages/config/src/env';`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(scratch, "test.cjs"),
    plugins: [
      {
        name: "fixtures",
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "mock",
          }));
          b.onResolve({ filter: /^\.\/services$/ }, () => ({
            path: "services",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents:
              args.path === "services"
                ? `export const resolveDataDir = () => ${JSON.stringify(scratch)};`
                : `import { createCipheriv, createDecipheriv } from 'node:crypto';
 const key = Buffer.alloc(32, 7), iv = Buffer.alloc(16, 4);
 export const safeStorage = { isEncryptionAvailable:()=>globalThis.encryption !== false,
 getSelectedStorageBackend:()=> 'secret_service',
 encryptString:s=>{const c=createCipheriv('aes-256-cbc',key,iv);return Buffer.concat([c.update(s),c.final()]);},
 decryptString:s=>{const c=createDecipheriv('aes-256-cbc',key,iv);return Buffer.concat([c.update(s),c.final()]).toString();}};`,
          }));
        },
      },
    ],
  });
  process.env.TMDB_API_KEY = "environmentFixture";
  delete process.env.TMDB_ACCESS_TOKEN;
  const m = createRequire(import.meta.url)(join(scratch, "test.cjs"));
  await m.loadTmdbSettings();
  assert.equal(m.tmdbSettingsStatus().source, "environment");
  await m.saveTmdbSettings({ accessToken: "fixture.token.value", apiKey: "" });
  assert.equal(m.tmdbSettingsStatus().source, "settings");
  const disk = await readFile(join(scratch, "tmdb-credentials.enc"));
  assert.ok(!disk.includes(Buffer.from("fixture.token.value")));
  assert.ok(
    !JSON.stringify(m.tmdbSettingsStatus()).includes("fixture.token.value"),
  );
  await m.loadTmdbSettings();
  assert.equal(m.tmdbSettingsStatus().saved, true);
  await assert.rejects(() =>
    m.saveTmdbSettings({ accessToken: "bad token\n", apiKey: "" }),
  );
  await assert.rejects(() =>
    m.saveTmdbSettings({ accessToken: "", apiKey: "" }),
  );
  globalThis.encryption = false;
  await assert.rejects(() =>
    m.saveTmdbSettings({ accessToken: "new", apiKey: "" }),
  );
  globalThis.encryption = true;
  await m.saveTmdbSettings(null);
  assert.equal(m.tmdbSettingsStatus().source, "environment");
  assert.equal(m.getServerEnv().TMDB_API_KEY, "environmentFixture");
  assert.equal(m.getServerEnv().TMDB_ACCESS_TOKEN, undefined);
  await writeFile(
    join(scratch, "tmdb-credentials.enc"),
    Buffer.from("corrupt"),
  );
  await m.loadTmdbSettings();
  assert.equal(m.tmdbSettingsStatus().loadError, true);
  await m.saveTmdbSettings(null);
  assert.equal(m.tmdbSettingsStatus().loadError, false);
  const both = { type: "custom-source", manifest: { kinds: ["movie", "tv"] } };
  assert.ok(m.matchesExtensionCategory(both, "movie"));
  assert.ok(m.matchesExtensionCategory(both, "tv"));
  assert.ok(!m.matchesExtensionCategory(both, "other"));
  const classic = { type: "custom-source", tags: ["movies", "classics"] };
  assert.ok(m.matchesExtensionCategory(classic, "movie"));
  assert.ok(!m.matchesExtensionCategory(classic, "tv"));
  const misleading = {
    type: "custom-source",
    tags: ["movies"],
    manifest: { kinds: ["tv"] },
  };
  assert.ok(!m.matchesExtensionCategory(misleading, "movie"));
  assert.ok(
    m.matchesExtensionCategory({ type: "manga-provider" }, "manga-provider"),
  );
  console.log(
    "PASS: encrypted persistence, reload, environment fallback, malformed input, unavailable encryption, corrupted storage and category mapping",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
