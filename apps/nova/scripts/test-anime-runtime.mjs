import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-anime-runtime-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export { CSharpAnimePool } from './apps/nova/electron/csharp-anime-pool'; export { CSharpAnimeEpisodes } from './apps/nova/electron/csharp-anime-episodes'; export { CSharpProviderSession } from './apps/nova/electron/csharp-worker';`,
    resolveDir: root,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "runtime.cjs"),
});
const { CSharpAnimePool, CSharpAnimeEpisodes, CSharpProviderSession } =
  createRequire(import.meta.url)(join(scratch, "runtime.cjs"));
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fakePool(capacity = 4) {
  const workers = [];
  const gates = new Map();
  const calls = [];
  const pool = new CSharpAnimePool(() => {
    const stopped = new AbortController();
    const worker = {
      id: null,
      stopped: false,
      async request(command, signal) {
        if (signal?.aborted) throw signal.reason;
        if (stopped.signal.aborted) throw Error("stopped");
        if (command.kind === "load") {
          this.id = command.provider.id;
          return ["getSettings"];
        }
        calls.push([this.id, command.method]);
        const gate = gates.get(`${this.id}:${command.method}`);
        if (gate) {
          const combined = signal
            ? AbortSignal.any([signal, stopped.signal])
            : stopped.signal;
          await new Promise((done, reject) => {
            const abort = () => reject(combined.reason);
            combined.addEventListener("abort", abort, { once: true });
            gate.promise.then(() => {
              combined.removeEventListener("abort", abort);
              done();
            });
          });
        }
        return this.id;
      },
      stop() {
        this.stopped = true;
        stopped.abort();
      },
    };
    workers.push(worker);
    return worker;
  }, capacity);
  return { pool, workers, gates, calls };
}

test("slow anime providers are isolated; calls within one provider stay serialized", async () => {
  const f = fakePool();
  try {
    await f.pool.load({ id: "a" });
    await f.pool.load({ id: "b" });
    const gate = deferred();
    f.gates.set("a:slow", gate);
    const abort = new AbortController();
    const slow = f.pool.call("a", "slow", [], abort.signal);
    const rejected = assert.rejects(slow, { name: "AbortError" });
    const after = f.pool.call("a", "next", []);
    assert.equal(await f.pool.call("b", "fast", []), "b");
    assert.equal(
      f.calls.some(([id, method]) => id === "a" && method === "next"),
      false,
    );
    abort.abort();
    await rejected;
    assert.equal(await after, "a");
    assert.equal(f.workers.find((w) => w.id === "b").stopped, false);
  } finally {
    f.pool.stop();
  }
});

test("capacity bounds resident workers, queues busy providers and reloads evicted definitions", async () => {
  const f = fakePool(1);
  try {
    await f.pool.load({ id: "a" });
    const gate = deferred();
    f.gates.set("a:slow", gate);
    const slow = f.pool.call("a", "slow", []);
    const loading = f.pool.load({ id: "b" });
    const controller = new AbortController();
    const cancelled = f.pool.call("b", "cancelled", [], controller.signal);
    controller.abort();
    await assert.rejects(cancelled, { name: "AbortError" });
    assert.equal(f.workers.length, 1);
    gate.resolve();
    await slow;
    await loading;
    assert.equal(f.workers[0].stopped, true);
    assert.equal(await f.pool.call("b", "fast", []), "b");
    assert.equal(await f.pool.call("a", "again", []), "a");
    assert.equal(f.workers.length, 3);
    assert.equal(f.workers.filter((w) => !w.stopped).length, 1);
    assert.equal(
      f.calls.some(([, method]) => method === "cancelled"),
      false,
    );
  } finally {
    f.pool.stop();
  }
});

test("disable rejects active and queued jobs without affecting another provider", async () => {
  const f = fakePool();
  try {
    await f.pool.load({ id: "a" });
    await f.pool.load({ id: "b" });
    f.gates.set("a:slow", deferred());
    const active = assert.rejects(f.pool.call("a", "slow", []));
    const queued = assert.rejects(f.pool.call("a", "queued", []), /disabled/);
    f.pool.remove("a");
    await Promise.all([active, queued]);
    await assert.rejects(f.pool.call("a", "again", []), /unavailable/);
    assert.equal(await f.pool.call("b", "fast", []), "b");
    await f.pool.load({ id: "a", source: "updated" });
    assert.equal(await f.pool.call("a", "fresh", []), "a");
  } finally {
    f.pool.stop();
  }
});

test("idle workers are released and shutdown rejects queued operations", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fakePool(1);
  await f.pool.load({ id: "a" });
  t.mock.timers.tick(60001);
  assert.equal(f.workers[0].stopped, true);
  f.gates.set("a:slow", deferred());
  const active = assert.rejects(f.pool.call("a", "slow", []));
  const loading = assert.rejects(f.pool.load({ id: "b" }), /disabled/);
  f.pool.stop();
  await Promise.all([active, loading]);
  await assert.rejects(f.pool.load({ id: "c" }), /shutting down/);
});

test("an old idle callback cannot stop an active or replaced worker", async (t) => {
  const callbacks = [];
  t.mock.method(globalThis, "setTimeout", (callback) => {
    callbacks.push(callback);
    return { unref() {} };
  });
  t.mock.method(globalThis, "clearTimeout", () => {});
  const f = fakePool(1);
  try {
    await f.pool.load({ id: "a" });
    const stale = callbacks[0];
    const gate = deferred();
    f.gates.set("a:slow", gate);
    const active = f.pool.call("a", "slow", []);
    await tick();
    stale();
    assert.equal(f.workers[0].stopped, false);
    gate.resolve();
    await active;
    await f.pool.load({ id: "b" });
    await f.pool.call("a", "fresh", []);
    const replacement = f.workers.at(-1);
    stale();
    assert.equal(replacement.stopped, false);
  } finally {
    f.pool.stop();
  }
});

test("a rejected provider load releases its slot and permits a repaired activation", async () => {
  let attempts = 0;
  let stopped = 0;
  const pool = new CSharpAnimePool(
    () => ({
      async request(command) {
        if (command.kind === "load" && ++attempts === 1)
          throw Error("invalid script");
        return command.kind === "load" ? ["getSettings"] : command.providerId;
      },
      stop() {
        stopped++;
      },
    }),
    1,
  );
  try {
    await assert.rejects(pool.load({ id: "broken" }), /invalid script/);
    assert.equal(pool.has("broken"), false);
    assert.equal(stopped, 1);
    await pool.load({ id: "broken", source: "fixed" });
    assert.equal(await pool.call("broken", "getSettings", []), "broken");
  } finally {
    pool.stop();
  }
});

const episode = {
  id: "ep-1",
  number: 1,
  url: "https://fixture.example/episode",
  provider: "fixture",
};
test("episode cache coalesces callers, reuses opaque handles and isolates caller cancellation", async () => {
  let calls = 0;
  let sharedSignal;
  const gate = deferred();
  const cache = new CSharpAnimeEpisodes(async (_id, signal) => {
    calls++;
    sharedSignal = signal;
    await gate.promise;
    return [episode];
  });
  const first = new AbortController();
  const a = assert.rejects(cache.list("title", first.signal), {
    name: "AbortError",
  });
  const b = cache.list("title");
  await tick();
  first.abort();
  await a;
  assert.equal(sharedSignal.aborted, false);
  gate.resolve();
  const rows = await b;
  const again = await cache.list("title");
  assert.equal(calls, 1);
  assert.equal(again[0].id, rows[0].id);
  assert.notEqual(rows[0].id, episode.id);
  assert.deepEqual(cache.get(rows[0].id), episode);
  rows[0].number = 999;
  assert.equal((await cache.list("title"))[0].number, 1);
});

test("cancelled, failed and empty episode loads remain retryable", async () => {
  let calls = 0;
  let sharedSignal;
  const gate = deferred();
  const cache = new CSharpAnimeEpisodes(async (_id, signal) => {
    sharedSignal = signal;
    if (++calls === 1) {
      await gate.promise;
      return [episode];
    }
    if (calls === 2) throw Error("offline");
    if (calls === 3) return [];
    return [episode];
  });
  const controller = new AbortController();
  const cancelled = assert.rejects(cache.list("title", controller.signal), {
    name: "AbortError",
  });
  await tick();
  controller.abort();
  await cancelled;
  assert.equal(sharedSignal.aborted, true);
  await assert.rejects(cache.list("title"), /offline/);
  assert.deepEqual(await cache.list("title"), []);
  assert.equal((await cache.list("title")).length, 1);
  gate.resolve();
  await tick();
  assert.equal((await cache.list("title")).length, 1);
  assert.equal(calls, 4);
});

test("episode metadata expires, is scoped to its activation and preserves previous handles", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  let calls = 0;
  const cache = new CSharpAnimeEpisodes(async () =>
    ++calls === 1
      ? [episode]
      : [episode, { ...episode, id: "ep-2", number: 2 }],
  );
  const first = await cache.list("title");
  t.mock.timers.tick(300001);
  const refreshed = await cache.list("title");
  assert.equal(refreshed.length, 2);
  assert.equal(refreshed[0].id, first[0].id);
  assert.deepEqual(cache.get(first[0].id), episode);
  const other = new CSharpAnimeEpisodes(async () => [
    { ...episode, number: 3 },
  ]);
  assert.equal((await other.list("title"))[0].number, 3);
  assert.equal(other.get(first[0].id), undefined);
});

test("episode cache bounds title storage and trims oversized lists", async () => {
  let calls = 0;
  const cache = new CSharpAnimeEpisodes(async (id) => {
    calls++;
    return [{ ...episode, id }];
  });
  for (let i = 0; i < 9; i++) await cache.list(String(i));
  await cache.list("8");
  assert.equal(calls, 9);
  await cache.list("0");
  assert.equal(calls, 10, "oldest title must be evicted");
  const large = new CSharpAnimeEpisodes(async () =>
    Array.from({ length: 2100 }, (_, i) => ({
      ...episode,
      id: String(i),
      number: i + 1,
    })),
  );
  const rows = await large.list("long-series");
  assert.equal(rows.length, 2000);
  for (let i = 0; i < 4; i++) await large.list("long-series");
  assert.deepEqual(
    large.get(rows[0].id),
    { ...episode, id: "0", number: 1 },
    "repeat listing must not evict active episode handles",
  );
});

if (process.argv.includes("--native"))
  test("real worker isolation, cancellation recovery and persistent store survive eviction", async () => {
    const dll =
      process.env.VESTRA_TEST_WORKER_TARGET ??
      join(root, "apps/server/bin/Release/net10.0/Vestra.Server.dll");
    const pool = new CSharpAnimePool(
      () => new CSharpProviderSession(dll, join(scratch, "store")),
      2,
    );
    const source = `class Provider {
    getSettings(){const n=($store.get('n')??0)+1;$store.set('n',n);return {episodeServers:[String(n)],supportsDub:false};}
    async search(options){if(options.query==='hang') return await new Promise(()=>{}); return [{id:'title',title:'Fixture'}];}
    findEpisodes(){return [{id:'ep',number:1,url:'https://fixture.example/ep'}];}
    findEpisodeServer(){return {server:'default',videoSources:[]};}
  }`;
    try {
      await pool.load({ id: "slow", source, hosts: [] });
      await pool.load({ id: "fast", source, hosts: [] });
      assert.equal(
        (await pool.call("slow", "getSettings", [])).episodeServers[0],
        "1",
      );
      const controller = new AbortController();
      const hanging = assert.rejects(
        pool.call("slow", "search", [{ query: "hang" }], controller.signal),
      );
      assert.equal(
        (await pool.call("fast", "getSettings", [])).episodeServers[0],
        "1",
      );
      controller.abort();
      await hanging;
      assert.equal(
        (await pool.call("slow", "getSettings", [])).episodeServers[0],
        "2",
      );
      await pool.load({ id: "third", source, hosts: [] });
      assert.equal(
        (await pool.call("fast", "getSettings", [])).episodeServers[0],
        "2",
      );
    } finally {
      pool.stop();
    }
  });

test("manga pool keeps a cancelled source isolated from another source and subsequent calls", async () => {
  const f = fakePool(2);
  try {
    await f.pool.load({ id: "slow-manga", type: "manga-provider" });
    await f.pool.load({ id: "fast-manga", type: "manga-provider" });
    const gate = deferred();
    f.gates.set("slow-manga:search", gate);
    const abort = new AbortController();
    const slow = f.pool.call(
      "slow-manga",
      "search",
      [{ query: "Fixture" }],
      abort.signal,
    );
    const rejected = assert.rejects(slow);
    assert.equal(
      await f.pool.call("fast-manga", "search", [{ query: "Fixture" }]),
      "fast-manga",
    );
    abort.abort();
    await rejected;
    assert.equal(
      await f.pool.call("fast-manga", "findChapters", ["book"]),
      "fast-manga",
    );
  } finally {
    f.pool.stop();
  }
});
