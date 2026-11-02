import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { after, test } from "node:test";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-shonen-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: [join(nova, "electron/provider-compat.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "compat.cjs"),
});
const { applyProviderCompatibility } = createRequire(import.meta.url)(
  join(scratch, "compat.cjs"),
);
const source =
  'class Provider { constructor() {this.siteBase="https://shonen.to";this.sourceBase=`${this.siteBase}/sources/shonen`;} }';
function fixture(data) {
  const requests = [];
  const repaired = applyProviderCompatibility(source, undefined, {
    id: "shonen",
    hosts: ["shonen.to"],
  });
  const provider = runInNewContext(repaired + ";new Provider()", {
    URL,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ data }) };
    },
  });
  return { provider, requests };
}
test("relative signed primary sources and captions survive normalization ahead of slow backups", async () => {
  const main = "/api/v1/zoko-media?u=signed&e=123&s=signature";
  const f = fixture({
    provider: "shonen",
    source: main,
    tracks: [
      {
        file: "/captions/en.vtt?token=123",
        kind: "subtitles",
        label: "English",
        default: true,
      },
    ],
    sources: [
      {
        file: main,
        type: "hls",
        tracks: [
          {
            file: "/captions/en.vtt?token=123",
            kind: "subtitles",
            label: "English",
            default: true,
          },
        ],
      },
      {
        file: "https://backup.example/api/stream/proxy?token=backup",
        type: "hls",
        tracks: [
          {
            file: "//backup.example/sub.vtt",
            kind: "subtitles",
            label: "Spanish",
          },
        ],
      },
    ],
  });
  const row = await f.provider.findEpisodeServer({ id: "20|1" }, "Sub");
  assert.equal(row.videoSources.length, 2);
  assert.equal(row.videoSources[0].url, "https://shonen.to" + main);
  assert.equal(row.videoSources[0].type, "m3u8");
  assert.equal(
    row.videoSources[0].subtitles[0].url,
    "https://shonen.to/captions/en.vtt?token=123",
  );
  assert.equal(row.videoSources[0].subtitles.length, 1);
  assert.equal(row.videoSources[1].subtitles[0].language, "Spanish");
  assert.equal(row.headers.Referer, "https://shonen.to/");
  assert.equal(new URL(f.requests[0].url).searchParams.get("episode"), "1");
});
test("absolute CDN and MP4 variants work; invalid schemes and duplicates are excluded", async () => {
  const f = fixture({
    provider: "shonen",
    source: "https://cdn.example/master.m3u8",
    sources: [
      { file: "https://cdn.example/master.m3u8" },
      { file: "/movie.mp4?token=a" },
      { file: "javascript:alert(1)", type: "hls" },
      { file: "https://user:pass@host.example/video.m3u8" },
      { file: "/unknown" },
    ],
  });
  const row = await f.provider.findEpisodeServer({ id: "20|1.5" }, "Sub");
  assert.equal(row.videoSources.length, 2);
  assert.equal(row.videoSources[1].type, "mp4");
});
test("bad identifiers, dub, unexpected responses and empty sources fail clearly", async () => {
  const f = fixture({ provider: "unexpected", sources: [] });
  await assert.rejects(
    f.provider.findEpisodeServer({ id: "invalid" }, "Sub"),
    /identifier/,
  );
  await assert.rejects(
    f.provider.findEpisodeServer({ id: "20|1" }, "Dub"),
    /subtitles only/,
  );
  assert.equal(f.requests.length, 0);
  await assert.rejects(
    f.provider.findEpisodeServer({ id: "20|1" }, "Sub"),
    /Unexpected/,
  );
  await assert.rejects(
    fixture({ provider: "shonen", sources: [] }).provider.findEpisodeServer(
      { id: "20|1" },
      "Sub",
    ),
    /playable stream/,
  );
});
test("repair applies only to the recognized installed Shonen adapter", () => {
  assert.equal(applyProviderCompatibility(source), source);
  assert.equal(
    applyProviderCompatibility(source, undefined, {
      id: "other",
      hosts: ["shonen.to"],
    }),
    source,
  );
  assert.equal(
    applyProviderCompatibility(source, undefined, {
      id: "shonen",
      hosts: ["other.example"],
    }),
    source,
  );
  assert.equal(
    applyProviderCompatibility("class Provider {}", undefined, {
      id: "shonen",
      hosts: ["shonen.to"],
    }),
    "class Provider {}",
  );
});
