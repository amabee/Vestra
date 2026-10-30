import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-streamplay-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: [join(root, "apps/nova/electron/streamplay.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "streamplay.cjs"),
});
const {
  extractStreamplay,
  streamplayFields,
  streamplayConfiguration,
  streamplayEmbed,
} = createRequire(import.meta.url)(join(scratch, "streamplay.cjs"));
const embed = "https://play.streamplay.co.in/embed/fixture";
const prefix = Buffer.from("https://play.streamplay.co.in/pl/").toString(
  "base64",
);
const html = `window.apx="${prefix}";window.qsx="fixture";window.kaken="opaque-episode-token";`;
// Independent OpenSSL AES-256-CBC / MD5 KDF vector; double-JSON payload matches the observed player protocol.
const configurationVector = {
  ct: "WbWoWJ9/oKDh+RT3XSE3HhysTiKEemNtBtKT1FvG2BTqjRCeVUloUS5uJp9fNZ1W",
  iv: "5728e026674bbf39b22c1b8e2dda2c0b",
  s: "0011223344556677",
};

test("literal dictionary fields are decoded without evaluating page scripts", () => {
  const packed = `evil();return p}('0.1="${prefix}";0.2="fixture";0.3="opaque-episode-token";',4,4,'window|apx|qsx|kaken'.split('|'))`;
  assert.deepEqual(streamplayFields(packed), streamplayFields(html));
  assert.equal(globalThis.evil, undefined);
  assert.throws(
    () =>
      streamplayFields(
        `return p}('0 0',2,1,'${"x".repeat(300000)}'.split('|'))`,
      ),
    /size limit/,
  );
  assert.throws(
    () =>
      streamplayFields(html.replace("opaque-episode-token", "x".repeat(65537))),
    /size limit/,
  );
  assert.throws(
    () => streamplayFields(html.replace("window.apx", "runCode")),
    /missing apx/,
  );
  assert.throws(() => streamplayFields("x".repeat(1048577)), /size limit/);
});
test("observed AES configuration and POST source protocol preserve HLS, MP4 and subtitle metadata", async () => {
  const config = configurationVector;
  assert.deepEqual(streamplayConfiguration(config), {
    apiURL: "https://api.example/player/",
  });
  const requests = [];
  const fetch = async (request) => {
    requests.push(request);
    return {
      status: 200,
      headers: {},
      body:
        requests.length === 1
          ? html
          : requests.length === 2
            ? JSON.stringify(config)
            : JSON.stringify({
                status: "success",
                sources: [
                  {
                    file: "https://cdn.example/main.m3u8",
                    type: "hls",
                    label: "1080p",
                  },
                  {
                    file: "https://cdn.example/main.mp4",
                    type: "mp4",
                    label: "720p",
                  },
                ],
                tracks: [
                  {
                    file: "https://cdn.example/en.vtt",
                    kind: "captions",
                    label: "English",
                    language: "en",
                    default: true,
                  },
                  { file: "https://cdn.example/thumb.vtt", kind: "thumbnails" },
                ],
              }),
    };
  };
  const result = await extractStreamplay(
    embed,
    "Server 2",
    "https://source.example/episode",
    undefined,
    fetch,
  );
  assert.equal(requests[1].url, "https://play.streamplay.co.in/pl/fixture");
  assert.equal(requests[2].method, "POST");
  assert.equal(requests[2].body, "opaque-episode-token");
  assert.equal(requests[2].url, "https://api.example/player/api/");
  assert.equal(
    requests[2].headers["X-Alt-Referer"],
    "https://source.example/episode",
  );
  assert.deepEqual(
    result.videoSources.map((row) => row.type),
    ["hls", "mp4"],
  );
  assert.equal(result.videoSources[0].subtitles.length, 1);
  assert.equal(result.videoSources[0].subtitles[0].isDefault, true);
  assert.equal(result.headers.Referer, embed);
});
test("wrong hosts, endpoint substitutions, empty configuration, damaged crypto and cancellation fail explicitly", async () => {
  assert.equal(
    streamplayEmbed(
      Error(
        "No scraper implemented for embed host: https://play.streamplay.co.in.attacker.test/embed/x",
      ),
    ),
    null,
  );
  assert.equal(
    streamplayEmbed(
      Error(
        "No scraper implemented for embed host: https://user@play.streamplay.co.in/embed/x",
      ),
    ),
    null,
  );
  const response = (body) => ({ status: 200, headers: {}, body });
  let calls = 0;
  await assert.rejects(
    extractStreamplay(embed, "Two", "", undefined, async () =>
      response(++calls === 1 ? html : ""),
    ),
    /no player configuration/,
  );
  await assert.rejects(
    extractStreamplay(embed, "Two", "", undefined, async () =>
      response(
        html.replace(
          prefix,
          Buffer.from("https://other.example/pl/").toString("base64"),
        ),
      ),
    ),
    /unexpected configuration endpoint/,
  );
  assert.throws(
    () =>
      streamplayConfiguration({
        ...configurationVector,
        ct: "AAAA",
      }),
    /could not be decoded/,
  );
  const controller = new AbortController();
  controller.abort();
  calls = 0;
  await assert.rejects(
    extractStreamplay(embed, "Two", "", controller.signal, async () => {
      calls++;
      return response(html);
    }),
  );
  assert.equal(calls, 0);
});
if (process.argv.includes("--live"))
  test("live Streamplay protocol observation reports current availability", async () => {
    try {
      const result = await extractStreamplay(
        "https://play.streamplay.co.in/embed/6xUD-TgciZVS2N5",
        "Streamplay",
        "https://donghuastream.org/",
      );
      console.log(
        "LIVE Streamplay",
        JSON.stringify({
          status: "sources-resolved",
          formats: result.videoSources.map((row) => row.type),
        }),
      );
    } catch (error) {
      if (!/no player configuration/.test(error.message)) throw error;
      console.log(
        "LIVE Streamplay upstream-unavailable: HTTP 200 with empty player configuration; no playable video claim.",
      );
    }
  });
