import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const novaRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(novaRoot, "../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-csharp-worker-"));
await build({
  entryPoints: [join(novaRoot, "electron/csharp-worker.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "client.cjs"),
});
const { CSharpProviderWorker, CSharpProviderSession } = createRequire(
  import.meta.url,
)(join(scratch, "client.cjs"));
after(() => rm(scratch, { recursive: true, force: true }));
const dll = join(root, "apps/server/bin/Release/net10.0/Vestra.Server.dll");

test("manga protocol validates its own contract and survives worker reload", async () => {
  const session = new CSharpProviderSession(dll);
  try {
    const source = `class Provider {
      getSettings(){return {supportsMultiLanguage:false,supportsMultiScanlator:false};}
      async search(opts){if(opts.query==='hang')return await new Promise(()=>{});return [{id:'book',title:'Fixture'}];}
      findChapters(id){return [{id:'chapter',title:'Chapter 1',chapter:'1',index:0,url:'https://manga.example/chapter'}];}
      findChapterPages(id){return [{url:'https://images.example/page.jpg',index:0,headers:{Referer:'https://manga.example/'}}];}
    }`;
    await session.request({
      kind: "load",
      provider: { id: "manga", type: "manga-provider", source, hosts: [] },
    });
    const call = (method, args) =>
      session.request({ kind: "call", providerId: "manga", method, args });
    assert.equal(
      (await call("search", [{ query: "fixture" }]))[0].provider,
      "manga",
    );
    assert.equal((await call("findChapters", ["book"]))[0].chapter, "1");
    await assert.rejects(call("findEpisodes", ["book"]), /Unsupported method/);
    const controller = new AbortController();
    const pending = session.request(
      {
        kind: "call",
        providerId: "manga",
        method: "search",
        args: [{ query: "hang" }],
      },
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 150);
    try {
      await assert.rejects(pending, /cancelled/);
    } finally {
      clearTimeout(timer);
    }
    const pages = await call("findChapterPages", ["chapter"]);
    assert.equal(pages[0].provider, "manga");
    assert.equal(pages[0].headers.Referer, "https://manga.example/");
  } finally {
    session.stop();
  }
});

test("session reloads after cancellation, retains store and does not retry the cancelled call", async () => {
  const session = new CSharpProviderSession(
    dll,
    join(scratch, "recovery-store"),
  );
  try {
    const script = source
      .replace(
        "return {episodeServers: ['default'], supportsDub: false};",
        "const n=($store.get('n')??0)+1;$store.set('n',n);return {episodeServers:[String(n)],supportsDub:false};",
      )
      .replace(
        "return [{id:'title',title:options.query,url:'https://fixture.example/title',subOrDub:'sub'}];",
        "return await new Promise(()=>{});",
      );
    await session.request({
      kind: "load",
      provider: { id: "recover", source: script, hosts: [] },
    });
    const settings = () =>
      session.request({
        kind: "call",
        providerId: "recover",
        method: "getSettings",
        args: [],
      });
    assert.equal((await settings()).episodeServers[0], "1");
    const controller = new AbortController();
    const pending = session.request(
      {
        kind: "call",
        providerId: "recover",
        method: "search",
        args: [{ query: "x" }],
      },
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 150);
    try {
      await assert.rejects(pending, /cancelled/);
    } finally {
      clearTimeout(timer);
    }
    assert.equal((await settings()).episodeServers[0], "2");
    await session.request({ kind: "unload", providerId: "recover" });
    assert.deepEqual(await session.request({ kind: "list" }), []);
  } finally {
    session.stop();
  }
  await assert.rejects(session.request({ kind: "list" }), /session stopped/);
});

const source = `class Provider {
  getSettings() { return {episodeServers: ['default'], supportsDub: false}; }
  async search(options) { return [{id:'title',title:options.query,url:'https://fixture.example/title',subOrDub:'sub'}]; }
  async findEpisodes(id) { return [{id:'ep1',number:1,url:'https://fixture.example/ep1'}]; }
  async findEpisodeServer(episode, server) { return {server,headers:{Referer:'https://fixture.example/'},
    videoSources:[{url:'https://fixture.example/video.m3u8',type:'m3u8',quality:'auto',subtitles:[]}]}; }
}`;

test("C# worker round trip: readiness, load, search, episodes, stream, errors, unload", async () => {
  const worker = new CSharpProviderWorker(dll);
  try {
    const methods = await worker.request({
      kind: "load",
      provider: { id: "fixture", source, hosts: [] },
    });
    assert.equal(methods.length, 4);
    const capabilities = await worker.request({ kind: "capabilities" });
    assert.equal(capabilities.gojaEnginePort, false);
    assert.equal(capabilities.fullSeanimeCompatibility, false);
    assert.ok(capabilities.extensionTypes.includes("manga-provider"));
    assert.equal(
      capabilities.responseSemantics,
      "seanime-synchronous-body-methods",
    );
    assert.deepEqual(await worker.request({ kind: "list" }), ["fixture"]);
    const call = (method, args) =>
      worker.request({ kind: "call", providerId: "fixture", method, args });
    const search = await call("search", [{ query: "Worker fixture" }]);
    assert.equal(search[0].title, "Worker fixture");
    const episodes = await call("findEpisodes", [search[0].id]);
    assert.equal(episodes[0].provider, "fixture");
    const stream = await call("findEpisodeServer", [episodes[0], "default"]);
    assert.equal(
      stream.videoSources[0].url,
      "https://fixture.example/video.m3u8",
    );
    assert.equal(stream.headers.Referer, "https://fixture.example/");
    await assert.rejects(
      worker.request({ kind: "invalid" }),
      /Unknown worker command/,
    );
    assert.equal((await call("getSettings", [])).supportsDub, false);
    assert.equal(
      await worker.request({ kind: "unload", providerId: "fixture" }),
      true,
    );
    assert.deepEqual(await worker.request({ kind: "list" }), []);
  } finally {
    worker.stop();
  }
});

test("Cancelling an active provider kills its worker and rejects further calls", async () => {
  const worker = new CSharpProviderWorker(dll);
  try {
    await worker.request({
      kind: "load",
      provider: {
        id: "fixture",
        source: source.replace(
          "return [{id:'title',title:options.query,url:'https://fixture.example/title',subOrDub:'sub'}];",
          "return await new Promise(() => {});",
        ),
        hosts: [],
      },
    });
    const controller = new AbortController();
    const pending = worker.request(
      {
        kind: "call",
        providerId: "fixture",
        method: "search",
        args: [{ query: "x" }],
      },
      controller.signal,
    );
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await assert.rejects(pending, /cancelled/);
    } finally {
      clearTimeout(timer);
    }
    await assert.rejects(worker.request({ kind: "list" }), /cancelled/);
  } finally {
    worker.stop();
  }
});
