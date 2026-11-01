import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-fonts-"));
globalThis.fontTestDirectory = scratch;
after(() => rm(scratch, { recursive: true, force: true }));
const live = process.argv.includes("--live");
await build({
  entryPoints: [join(root, "apps/nova/electron/subtitle-fonts.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "fonts.cjs"),
  plugins: [
    {
      name: "font-fixture",
      setup(b) {
        b.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "fixture",
        }));
        if (!live)
          b.onResolve({ filter: /^\.\/safe-fetch$/ }, () => ({
            path: "fetch",
            namespace: "fixture",
          }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents:
            path === "electron"
              ? "export const app={getPath:()=>globalThis.fontTestDirectory};"
              : "export const safeFetch=(request)=>globalThis.fontFetch(request); export const safeFetchBytes=(request)=>globalThis.fontBytes(request);",
        }));
      },
    },
  ],
});
const fonts = createRequire(import.meta.url)(join(scratch, "fonts.cjs"));

test(
  "font catalogue and installs share requests, persist and recover from a failed download",
  { skip: live },
  async () => {
    let catalogues = 0,
      downloads = 0;
    globalThis.fontFetch = async ({ url }) => {
      if (url.includes("metadata")) {
        catalogues++;
        return {
          status: 200,
          body: JSON.stringify({
            familyMetadataList: [{ family: "Roboto" }, { family: "Georgia" }],
          }),
        };
      }
      return {
        status: 200,
        body: '@font-face { src: url("https://fonts.gstatic.com/fixture.ttf") format("truetype"); }',
      };
    };
    globalThis.fontBytes = async () => {
      downloads++;
      return new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    };
    assert.deepEqual(
      await Promise.all([
        fonts.searchGoogleFonts("rob"),
        fonts.searchGoogleFonts("geo"),
      ]),
      [["Roboto"], ["Georgia"]],
    );
    assert.equal(catalogues, 1);
    assert.deepEqual(
      await Promise.all([
        fonts.installGoogleFont("Roboto"),
        fonts.installGoogleFont("Roboto"),
      ]),
      ["Roboto", "Roboto"],
    );
    assert.equal(downloads, 1);
    assert.equal(fonts.subtitleFontRevision(), 1);
    await fonts.installGoogleFont("Roboto");
    assert.equal(
      downloads,
      1,
      "installed fonts are applied without downloading again",
    );
    assert.deepEqual(fonts.listInstalledSubtitleFonts(), ["Roboto"]);
    const index = JSON.parse(
      await readFile(
        join(fonts.subtitleFontsDirectory(), "index.json"),
        "utf8",
      ),
    );
    assert.match(index.Roboto, /^[a-f0-9]{16}\.ttf$/);
    globalThis.fontBytes = async () =>
      new TextEncoder().encode("<!doctype html>");
    await assert.rejects(
      fonts.installGoogleFont("Georgia"),
      /format subtitles cannot use/,
    );
    assert.deepEqual(fonts.listInstalledSubtitleFonts(), ["Roboto"]);
    globalThis.fontBytes = async () =>
      new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await fonts.installGoogleFont("Georgia");
    assert.equal(fonts.subtitleFontRevision(), 2);
    assert.deepEqual(fonts.listInstalledSubtitleFonts(), ["Georgia", "Roboto"]);
    await unlink(join(fonts.subtitleFontsDirectory(), index.Roboto));
    assert.deepEqual(fonts.listInstalledSubtitleFonts(), ["Georgia"]);
    await assert.rejects(
      fonts.installGoogleFont("../escape"),
      /valid font family/,
    );
    assert.equal(catalogues, 1);
  },
);

test(
  "Google Fonts can install a real subtitle font into an isolated directory",
  { skip: !live },
  async () => {
    assert.ok((await fonts.searchGoogleFonts("Roboto")).includes("Roboto"));
    assert.equal(await fonts.installGoogleFont("Roboto"), "Roboto");
    assert.deepEqual(fonts.listInstalledSubtitleFonts(), ["Roboto"]);
  },
);
