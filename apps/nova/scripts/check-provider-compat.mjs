import { build } from "esbuild";
import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  root = resolve(nova, "../..");
const scratch = await mkdtemp(join(nova, "node_modules/.vestra-compat-"));
const require = createRequire(import.meta.url);
let worker;
try {
  await build({
    entryPoints: [
      join(nova, "electron/csharp-worker.ts"),
      join(nova, "electron/provider-transpile.ts"),
      join(nova, "electron/provider-compat.ts"),
    ],
    bundle: true,
    platform: "node",
    format: "cjs",
    outdir: scratch,
  });
  const { CSharpProviderWorker } = require(join(scratch, "csharp-worker.js"));
  const { transpileProvider } = require(join(scratch, "provider-transpile.js"));
  const { applyProviderCompatibility, chooseEpisodeServer } = require(
    join(scratch, "provider-compat.js"),
  );
  const dll = join(root, "apps/server/bin/Release/net10.0/Vestra.Server.dll");
  assert.equal(
    chooseEpisodeServer(["Server 1", "Server 2"], "Server 2"),
    "Server 2",
  );
  assert.equal(chooseEpisodeServer([]), "default");
  assert.throws(
    () => chooseEpisodeServer(["Server 1"], "Missing"),
    /unavailable/,
  );
  const start = () => new CSharpProviderWorker(dll, join(scratch, "store"));
  worker = start();
  const source = `class Provider {
    getSettings(): {episodeServers:string[],supportsDub:boolean} {
      const before=$store.get('counter')??0;$store.set('counter',before+1);
      const iv=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
      const cipher=CryptoJS.AES.encrypt('fixture','0123456789abcdef',{iv});
      return {episodeServers:[String(before),CryptoJS.SHA256('abc').toString(),cipher.toString(),
        CryptoJS.AES.decrypt(cipher,'0123456789abcdef',{iv}).toString(CryptoJS.enc.Utf8),
        CryptoJS.AES.decrypt(CryptoJS.AES.encrypt('roundtrip','password'),'password').toString(CryptoJS.enc.Utf8),
        String(crypto.getRandomValues(new Uint8Array(16)).length),
        CryptoJS.AES.decrypt('SALTED_FIXTURE','password').toString(CryptoJS.enc.Utf8),
        CryptoJS.MD5('abc').toString(),CryptoJS.SHA1('abc').toString(),
        CryptoJS.enc.Utf16.parse('世界').toString(CryptoJS.enc.Utf16)],supportsDub:false};
    }
    search(o:any){return [];}
    findEpisodes(id:string){return [];}
    findEpisodeServer(ep:any,s:string){throw new Error('unused');}
  }`;
  let previous = Buffer.alloc(0),
    material = Buffer.alloc(0);
  const salt = Buffer.from("12345678");
  while (material.length < 48) {
    previous = createHash("md5")
      .update(Buffer.concat([previous, Buffer.from("password"), salt]))
      .digest();
    material = Buffer.concat([material, previous]);
  }
  const saltedCipher = createCipheriv(
    "aes-256-cbc",
    material.subarray(0, 32),
    material.subarray(32, 48),
  );
  const salted = Buffer.concat([
    Buffer.from("Salted__"),
    salt,
    saltedCipher.update("salted fixture"),
    saltedCipher.final(),
  ]).toString("base64");
  const compiled = transpileProvider(
    source.replace("SALTED_FIXTURE", salted),
    "fixture.ts",
  );
  assert.throws(() =>
    transpileProvider("class Provider { broken(: }", "broken.ts"),
  );
  const load = async (id, source, hosts = []) =>
    worker.request({ kind: "load", provider: { id, source, hosts } });
  const call = (id, method, args = []) =>
    worker.request({ kind: "call", providerId: id, method, args });
  await load("fixture", compiled);
  let values = (await call("fixture", "getSettings")).episodeServers;
  assert.equal(values[0], "0");
  assert.equal(values[1], createHash("sha256").update("abc").digest("hex"));
  const aes = createCipheriv(
    "aes-128-cbc",
    Buffer.from("0123456789abcdef"),
    Buffer.from("000102030405060708090a0b0c0d0e0f", "hex"),
  );
  assert.equal(
    values[2],
    Buffer.concat([aes.update("fixture"), aes.final()]).toString("base64"),
  );
  assert.equal(values[3], "fixture");
  assert.equal(values[4], "roundtrip");
  assert.equal(values[5], "16");
  assert.equal(values[6], "salted fixture");
  assert.equal(values[7], createHash("md5").update("abc").digest("hex"));
  assert.equal(values[8], createHash("sha1").update("abc").digest("hex"));
  assert.equal(values[9], "世界");
  await load(
    "bad-iv",
    compiled.replace("000102030405060708090a0b0c0d0e0f", "0001"),
  );
  await assert.rejects(call("bad-iv", "getSettings"), /IV/);
  worker.stop();
  worker = start();
  await load("fixture", compiled);
  assert.equal((await call("fixture", "getSettings")).episodeServers[0], "1");
  await load("other", compiled);
  assert.equal((await call("other", "getSettings")).episodeServers[0], "0");
  // Transpile and load an existing large TS provider without executing its network calls.
  const tsPath = join(root, "Seanime-Providers/src/anime/AnimeAV1/main.ts");
  await load(
    "av1-typescript",
    transpileProvider(await readFile(tsPath, "utf8"), tsPath),
  );
  assert.equal(
    typeof (await call("av1-typescript", "getSettings")).supportsDub,
    "boolean",
  );
  console.log(
    "PASS: TypeScript diagnostics, real TS provider load, AES/Node vector, hashes, randomness, persistent restart and provider isolation",
  );
  const fixtureSource = await readFile(
    join(root, "Seanime-Providers/src/anime/animesaturnmirror/provider.js"),
    "utf8",
  );
  const repairedFixture =
    applyProviderCompatibility(fixtureSource, "animesaturn-nested-player-v1") +
    `
    fetch=async function(url){const pages={
      'https://fixture.example/episode':'<div id="pembed"><iframe src="/wrapper"></iframe></div>',
      'https://fixture.example/wrapper':'<iframe src="https://embed.example/player"></iframe>',
      'https://embed.example/player':'<script>var primary = "https://cdn.example/master.m3u8";</script>'
    };if(!pages[String(url)])throw new Error('Unexpected fixture URL');return {ok:true,status:200,text:async()=>pages[String(url)]};};`;
  await load("nested-fixture", repairedFixture);
  const repaired = await call("nested-fixture", "findEpisodeServer", [
    { id: "episode", number: 1, url: "https://fixture.example/episode" },
    "Server 1",
  ]);
  assert.equal(repaired.videoSources[0].url, "https://cdn.example/master.m3u8");
  assert.equal(repaired.headers.Referer, "https://embed.example/player");
  await load(
    "nested-cycle",
    repairedFixture.replace(
      'https://embed.example/player\"></iframe>',
      'https://fixture.example/wrapper\"></iframe>',
    ),
  );
  await assert.rejects(
    call("nested-cycle", "findEpisodeServer", [
      { id: "episode", number: 1, url: "https://fixture.example/episode" },
      "Server 1",
    ]),
    /cycle/,
  );
  console.log(
    "PASS: nested iframe repair, relative URL resolution, Referer preservation and cycle rejection",
  );
  if (process.argv.includes("--live")) {
    const report = {
      checkedAt: new Date().toISOString(),
      scope:
        "Live search, episodes, stream URL resolution and repaired-source HLS manifest validation; no playback or media segments downloaded",
      providers: [],
    };
    for (const [id, hosts] of [
      ["anidb", ["anidb.app"]],
      ["animesaturnmirror", ["animesaturn.ro"]],
      [
        "donghuastream",
        [
          "donghuastream.org",
          "geo.dailymotion.com",
          "www.dailymotion.com",
          "rumble.com",
        ],
      ],
    ]) {
      const query = id === "donghuastream" ? "Battle" : "Naruto";
      const row = { id, query, steps: [] };
      report.providers.push(row);
      let src;
      try {
        src = await readFile(
          join(root, `Seanime-Providers/src/anime/${id}/provider.js`),
          "utf8",
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        row.steps.push({
          stage: "load",
          error:
            "Local provider source is absent; skipped without aborting other providers.",
        });
        row.status = "source-missing";
        console.log(JSON.stringify(row));
        continue;
      }
      row.sourceSha256 = createHash("sha256").update(src).digest("hex");
      if (id === "animesaturnmirror" && process.argv.includes("--repair")) {
        src = applyProviderCompatibility(src, "animesaturn-nested-player-v1");
        hosts.push("cdn2.megaplay.su");
        row.compatibility = "animesaturn-nested-player-v1";
      }
      if (id === "animesaturnmirror")
        src = src.replace(
          'throw new Error("Could not find file URL in player page");',
          'throw new Error("Player extraction failed; status="+playerRes.status+"; title="+(playerHtml.match(/<title[^>]*>([^<]*)/i)?.[1]??"absent").slice(0,80)+"; has_file_field="+ /file\\s*:/i.test(playerHtml));',
        );
      await load(id, src, hosts);
      if (
        id === "animesaturnmirror" &&
        process.argv.includes("--capture-player")
      ) {
        src = src.replace(
          "const playerHtml = await playerRes.text();",
          'const playerHtml = await playerRes.text(); $store.set("probe-player", playerHtml);',
        );
        await load(id, src, hosts);
      }
      let stage = "search";
      const begin = Date.now();
      try {
        const found = await call(id, "search", [
          {
            query,
            dub: false,
            year: 0,
            media: {
              id: 0,
              romajiTitle: query,
              synonyms: [],
              episodeCount: -1,
              status: "FINISHED",
              format: "TV",
              isAdult: false,
            },
          },
        ]);
        row.steps.push({ stage, count: found.length });
        if (!found.length) continue;
        stage = "episodes";
        const eps = await call(id, "findEpisodes", [found[0].id]);
        row.steps.push({ stage, count: eps.length });
        if (!eps.length) continue;
        stage = "stream";
        const settings = await call(id, "getSettings");
        const result = await call(id, "findEpisodeServer", [
          eps[0],
          settings.episodeServers[0] ?? "default",
        ]);
        row.steps.push({ stage, count: result.videoSources.length });
        if (
          result.videoSources.length &&
          ["m3u8", "hls"].includes(result.videoSources[0].type)
        ) {
          stage = "manifest";
          const video = result.videoSources[0];
          const manifestProbe = `class Provider {
            async getSettings(){const r=await fetch(${JSON.stringify(video.url)},{headers:${JSON.stringify(result.headers ?? {})}});const text=await r.text();return {supportsDub:false,episodeServers:[String(r.status),String(text.trimStart().startsWith('#EXTM3U'))]};}
            search(){return [];}findEpisodes(){return [];}findEpisodeServer(){throw new Error('unused');}
          }`;
          // One isolated metadata probe of the returned media host. This does
          // not change the provider's installed grants; transport still pins
          // connections to checked public addresses and checks redirects.
          await load("manifest-probe", manifestProbe, [
            new URL(video.url).hostname,
          ]);
          const check = await call("manifest-probe", "getSettings");
          row.steps.push({
            stage,
            httpStatus: Number(check.episodeServers[0]),
            isHls: check.episodeServers[1] === "true",
          });
          if (
            check.episodeServers[0] !== "200" ||
            check.episodeServers[1] !== "true"
          ) {
            for (const server of settings.episodeServers.slice(1, 3)) {
              try {
                const mirror = await call(id, "findEpisodeServer", [
                  eps[0],
                  server,
                ]);
                const media = mirror.videoSources[0];
                if (!media) continue;
                const probe = `class Provider {
                  async getSettings(){const r=await fetch(${JSON.stringify(media.url)},{headers:${JSON.stringify(mirror.headers ?? {})}});const text=await r.text();return {supportsDub:false,episodeServers:[String(r.status),String(text.trimStart().startsWith('#EXTM3U'))]};}
                  search(){return [];}findEpisodes(){return [];}findEpisodeServer(){throw new Error('unused');}
                }`;
                await load("manifest-probe", probe, [
                  new URL(media.url).hostname,
                ]);
                const checked = await call("manifest-probe", "getSettings");
                row.steps.push({
                  stage: "mirror-manifest",
                  server,
                  httpStatus: Number(checked.episodeServers[0]),
                  isHls: checked.episodeServers[1] === "true",
                });
                if (
                  checked.episodeServers[0] === "200" &&
                  checked.episodeServers[1] === "true"
                )
                  break;
              } catch (error) {
                row.steps.push({
                  stage: "mirror",
                  server,
                  error: String(error.message).slice(0, 600),
                });
              }
            }
          }
        }
      } catch (error) {
        row.steps.push({ stage, error: String(error.message).slice(0, 600) });
      }
      row.elapsedMs = Date.now() - begin;
      row.status = row.steps.some(
        (s) =>
          ["manifest", "mirror-manifest"].includes(s.stage) &&
          s.httpStatus === 200 &&
          s.isHls,
      )
        ? "manifest-verified"
        : row.steps.some((s) => s.stage === "stream" && s.count > 0)
          ? "resolved-unverified"
          : "failed";
      if (
        id === "animesaturnmirror" &&
        process.argv.includes("--capture-player")
      ) {
        await load(
          id,
          src +
            '\nProvider.prototype.getSettings=function(){return {supportsDub:false,episodeServers:($store.get("probe-player")||"").match(/[\\s\\S]{1,400}/g)||[]};};',
          hosts,
        );
        const snapshot = await call(id, "getSettings");
        await writeFile(
          join(root, ".tools/saturn-player.html"),
          snapshot.episodeServers.join(""),
        );
      }
      console.log(JSON.stringify(row));
    }
    report.summary = {
      manifestVerified: report.providers.filter(
        (p) => p.status === "manifest-verified",
      ).length,
      unresolved: report.providers.filter(
        (p) => p.status !== "manifest-verified",
      ).length,
    };
    await writeFile(
      join(root, "docs/live-provider-report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
} finally {
  worker?.stop();
  await rm(scratch, { recursive: true, force: true });
}
