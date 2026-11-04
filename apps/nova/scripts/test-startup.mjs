import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(nova, "node_modules/.startup-tests-"));
after(() =>
  rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  }),
);
await build({
  stdin: {
    contents: `export {StartupGate} from './electron/startup-gate';export {warmStartupCache} from './renderer/src/lib/startup-cache';export {createQueryClient} from './renderer/src/lib/query-client';`,
    resolveDir: nova,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
});
const { StartupGate, warmStartupCache, createQueryClient } = createRequire(
  import.meta.url,
)(join(scratch, "test.cjs"));

test("startup requires local config and renderer hydration; optional work cannot reveal an empty window", () => {
  let opens = 0;
  const gate = new StartupGate(
    "fixture",
    () => {},
    () => opens++,
  );
  try {
    gate.step("extensions", "ready");
    gate.update("current");
    assert.equal(gate.continue(), false);
    gate.rendererReady();
    assert.equal(opens, 0);
    gate.step("config", "ready");
    assert.equal(opens, 1);
    assert.equal(gate.continue(), false);
    assert.equal(opens, 1);
  } finally {
    gate.dispose();
  }
});
test("offline updates and skipped extensions are nonfatal and retain honest warning states", () => {
  const gate = new StartupGate(
    "fixture",
    () => {},
    () => {},
  );
  try {
    gate.step("config", "ready");
    gate.step("extensions", "warning");
    gate.update("offline");
    gate.rendererReady(1);
    assert.equal(gate.snapshot().opened, true);
    assert.equal(gate.snapshot().steps.cache, "warning");
    assert.equal(gate.snapshot().steps.updates, "warning");
  } finally {
    gate.dispose();
  }
});
test("a slow optional task moves to the background and late starts cannot block handoff again", async () => {
  let opens = 0;
  const gate = new StartupGate(
    "fixture",
    () => {},
    () => opens++,
    10,
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    gate.step("extensions", "loading");
    assert.equal(gate.snapshot().steps.extensions, "background");
    assert.equal(opens, 0);
    gate.step("config", "ready");
    gate.rendererReady();
    assert.equal(opens, 1);
  } finally {
    gate.dispose();
  }
});
test("manual handoff waits for core readiness, and fatal startup errors cannot be bypassed", () => {
  const gate = new StartupGate(
    "fixture",
    () => {},
    () => {},
  );
  try {
    gate.step("config", "ready");
    gate.rendererReady();
    assert.equal(gate.snapshot().canContinue, true);
    gate.fail();
    assert.equal(gate.continue(), false);
    assert.equal(gate.snapshot().opened, false);
  } finally {
    gate.dispose();
  }
});
test("a renderer that never becomes ready offers restart instead of an endless splash", async () => {
  const gate = new StartupGate(
    "fixture",
    () => {},
    () => assert.fail("Must not open"),
    5,
    15,
  );
  try {
    gate.step("config", "ready");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(gate.snapshot().error, true);
    assert.equal(gate.continue(), false);
  } finally {
    gate.dispose();
  }
});

test("saved data hydrates real shared query keys, preserves failures, and never fetches discovery", async () => {
  const client = createQueryClient();
  const fixture = {
    settings: { get: async () => ({ theme: "fixture" }) },
    library: { files: async () => ["file"] },
    history: { list: async () => ["history"] },
    watchlist: { list: async () => ["saved"] },
    progress: { all: async () => ({ position: 14 }) },
    bookmarks: {
      all: async () => {
        throw Error("unreadable");
      },
    },
  };
  globalThis.window = { vestra: fixture };
  try {
    assert.equal(await warmStartupCache(client), 1);
    assert.deepEqual(client.getQueryData(["settings"]), { theme: "fixture" });
    assert.deepEqual(client.getQueryData(["watchlist"]), ["saved"]);
    assert.equal(client.getQueryState(["bookmarks"]).status, "error");
    assert.equal(client.getQueryCache().getAll().length, 6);
    fixture.library.files = () => new Promise(() => {});
    client.removeQueries({ queryKey: ["library"] });
    assert.equal(await warmStartupCache(client, 10), 6);
  } finally {
    client.clear();
    delete globalThis.window;
  }
});
