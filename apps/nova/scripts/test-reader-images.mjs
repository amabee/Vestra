import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-reader-images-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: {
    images: join(nova, "renderer/src/lib/reader-images.ts"),
    lookups: join(nova, "renderer/src/lib/cover-lookups.ts"),
    pool: join(nova, "electron/csharp-image-pool.ts"),
    worker: join(nova, "electron/csharp-worker.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: scratch,
});
const require = createRequire(import.meta.url);
const { ReaderImages, hoverPage } = require(join(scratch, "images.js"));
const { CoverLookups } = require(join(scratch, "lookups.js"));
const { CSharpImagePool } = require(join(scratch, "pool.js"));
const { CSharpProviderWorker } = require(join(scratch, "worker.js"));
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("cover metadata is bounded, skips cancelled work and recovers from synchronous bridge errors", async () => {
  const lookups = new CoverLookups(),
    signal = new AbortController(),
    cancelled = new AbortController();
  const pending = [];
  let started = 0;
  const work = () => {
    started++;
    return new Promise((resolve) => pending.push(resolve));
  };
  const first = lookups.run(work, signal.signal),
    second = lookups.run(work, signal.signal);
  const skipped = assert.rejects(
    lookups.run(work, cancelled.signal),
    /cancelled/,
  );
  cancelled.abort();
  await skipped;
  await tick();
  assert.equal(started, 2);
  pending[0](1);
  pending[1](2);
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  await assert.rejects(
    lookups.run(() => {
      throw new Error("old bridge");
    }, signal.signal),
    /old bridge/,
  );
  assert.equal(await lookups.run(async () => 3, signal.signal), 3);
  lookups.dispose();
  await assert.rejects(
    lookups.run(async () => 4, signal.signal),
    /cancelled/,
  );
});
test("look-ahead reserves capacity for foreground work, de-duplicates, and prioritizes previews", async () => {
  const started = [],
    pending = new Map();
  const images = new ReaderImages((handle) => {
    started.push(handle);
    return new Promise((resolve) => pending.set(handle, resolve));
  });
  images.prefetch(["a", "b", "c", "d", "e", "f"]);
  await tick();
  assert.deepEqual(started, ["a", "b", "c"]);
  const foreground = images.load("current");
  const duplicate = images.load("current");
  assert.equal(foreground, duplicate);
  await tick();
  assert.deepEqual(started, ["a", "b", "c", "current"]);
  const obsolete = assert.rejects(
    images.preview("old-hover"),
    /Preview position changed/,
  );
  const preview = images.preview("hover");
  await obsolete;
  await tick();
  assert.equal(started.length, 4);
  pending.get("a")("image-a");
  await tick();
  assert.equal(started[4], "hover");
  pending.get("hover")("image-hover");
  pending.get("current")("image-current");
  await Promise.all([foreground, preview]);
  assert.equal(await images.load("current"), "image-current");
  assert.equal(started.filter((h) => h === "current").length, 1);
  images.dispose();
  for (const complete of pending.values()) complete("image");
  await tick();
});
test("bounded LRU evicts old data and failed requests can retry immediately", async () => {
  const calls = [];
  const images = new ReaderImages(async (handle) => {
    calls.push(handle);
    return handle.repeat(3);
  }, 12);
  await images.load("a");
  await images.load("b");
  await images.load("a");
  await images.load("c");
  await images.load("b");
  assert.deepEqual(calls, ["a", "b", "c", "b"]);
  images.dispose();
  let tries = 0;
  const retry = new ReaderImages(async () => {
    if (++tries === 1) throw new Error("offline");
    return "ok";
  });
  await assert.rejects(retry.load("x"), /offline/);
  assert.equal(await retry.load("x"), "ok");
  retry.dispose();
});
test("changing position drops obsolete pending preloads and closing the chapter stops queued work", async () => {
  const started = [],
    complete = [];
  const images = new ReaderImages((handle) => {
    started.push(handle);
    return new Promise((resolve) => complete.push(resolve));
  });
  images.prefetch(["a", "b", "c", "old"]);
  await tick();
  images.prefetch(["new"]);
  complete[0]("a");
  await tick();
  assert.ok(started.includes("new"));
  assert.ok(!started.includes("old"));
  images.dispose();
  await assert.rejects(images.load("closed"), /Chapter closed/);
  for (const done of complete) done("image");
  await tick();
});
test("progress hover mapping clamps at the first and last page and handles one page", () => {
  assert.equal(hoverPage(0, 20, 100, 20), 0);
  assert.equal(hoverPage(200, 20, 100, 20), 19);
  assert.equal(hoverPage(70, 20, 100, 21), 10);
  assert.equal(hoverPage(70, 20, 100, 1), 0);
});
test("image-only sidecars run four lanes and do not replay failed image calls", async () => {
  let created = 0,
    active = 0,
    maximum = 0,
    stops = 0;
  const releases = [];
  const pool = new CSharpImagePool(() => {
    created++;
    let queue = Promise.resolve();
    return {
      isFailed: false,
      stop() {
        stops++;
      },
      request(command) {
        assert.equal(command.kind, "image");
        const result = queue.then(
          () =>
            new Promise((resolve) => {
              active++;
              maximum = Math.max(maximum, active);
              releases.push(() => {
                active--;
                resolve(command.request);
              });
            }),
        );
        queue = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    };
  });
  const work = Array.from({ length: 6 }, (_, index) => pool.image(index));
  await tick();
  assert.equal(created, 4);
  assert.equal(maximum, 4);
  assert.equal(releases.length, 4);
  for (let index = 0; index < 6; index++) {
    releases[index]();
    await tick();
  }
  assert.deepEqual(await Promise.all(work), [0, 1, 2, 3, 4, 5]);
  pool.stop();
  assert.equal(stops, 4);
  await assert.rejects(pool.image(7), /shutting down/);
  let attempts = 0;
  const broken = new CSharpImagePool(() => ({
    isFailed: false,
    stop() {},
    async request() {
      attempts++;
      throw new Error("network");
    },
  }));
  await assert.rejects(broken.image({}), /network/);
  assert.equal(attempts, 1);
  broken.stop();
});
test("real image sidecars retain the guarded HTTPS destination policy", async () => {
  const dll = join(nova, "../server/bin/Release/net10.0/Vestra.Server.dll");
  const pool = new CSharpImagePool(
    () => new CSharpProviderWorker(dll, join(scratch, "isolated-store")),
  );
  try {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        assert.rejects(
          pool.image({ url: "https://127.0.0.1/private", method: "GET" }),
          /HTTPS host grants/,
        ),
      ),
    );
  } finally {
    pool.stop();
  }
});
