import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  unlink,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { root, validateLock, verifySnapshot } from "./foundry-snapshot.mjs";

async function fixture(run) {
  const base = await mkdtemp(join(tmpdir(), "vestra-foundry-test-"));
  const text = "export function activate() {}\n";
  const lock = {
    schema: 1,
    repository: "amabee/Foundry",
    revision: "a".repeat(40),
    files: [
      {
        path: "extensions/example/index.js",
        sha256: createHash("sha256").update(text).digest("hex"),
      },
    ],
  };
  await mkdir(join(base, "extensions/example"), { recursive: true });
  await writeFile(join(base, "extensions/example/index.js"), text);
  await writeFile(join(base, "extensions.snapshot.json"), JSON.stringify(lock));
  try {
    await run(base, lock);
  } finally {
    assert.ok(resolve(base).startsWith(resolve(tmpdir()) + sep));
    await rm(base, { recursive: true, force: true });
  }
}
test("the real offline bundle matches its Foundry revision and immutable registry", async () => {
  const lock = await verifySnapshot();
  assert.equal(lock.repository, "amabee/Foundry");
  const registry = JSON.parse(
    await readFile(join(root, "extensions/registry.json"), "utf8"),
  );
  assert.equal(registry.length, 46);
  for (const entry of registry) {
    const manifest = new URL(entry.manifestURI);
    assert.equal(manifest.hostname, "raw.githubusercontent.com");
    assert.match(
      manifest.pathname,
      /^\/amabee\/Foundry\/[0-9a-f]{40}\/extensions\//,
    );
    assert.ok(!entry.payloadURI.includes("/main/"));
    assert.notEqual(entry.id, "vestra-streamflix");
  }
});
test("snapshot verification detects source tampering", async () =>
  fixture(async (base) => {
    await verifySnapshot(base);
    await writeFile(join(base, "extensions/example/index.js"), "changed");
    await assert.rejects(() => verifySnapshot(base), /snapshot changed/);
  }));
test("unexpected or missing files cannot silently enter the offline bundle", async () =>
  fixture(async (base) => {
    await writeFile(
      join(base, "extensions/example/unreviewed.js"),
      "unreviewed",
    );
    await assert.rejects(() => verifySnapshot(base), /inventory differs/);
  }));
test("lock validation rejects traversal, mutable revisions, other repositories and duplicate paths", async () =>
  fixture(async (_base, lock) => {
    for (const path of [
      "../outside.js",
      "extensions/../outside.js",
      "C:/outside.js",
      "extensions/example/../../outside.js",
      "extensions\\example\\index.js",
    ])
      assert.throws(
        () => validateLock({ ...lock, files: [{ ...lock.files[0], path }] }),
        /path/,
      );
    assert.throws(() => validateLock({ ...lock, revision: "main" }), /lock/);
    assert.throws(
      () =>
        validateLock({
          ...lock,
          files: Array.from({ length: 257 }, (_, i) => ({
            path: `extensions/source-${i}/index.js`,
            sha256: "a".repeat(64),
          })),
        }),
      /lock/,
    );
    assert.throws(
      () => validateLock({ ...lock, repository: "other/repo" }),
      /lock/,
    );
    assert.throws(
      () => validateLock({ ...lock, files: [lock.files[0], lock.files[0]] }),
      /duplicate/,
    );
    assert.throws(
      () =>
        validateLock({ ...lock, files: [{ ...lock.files[0], sha256: "bad" }] }),
      /hash/,
    );
  }));

test("missing locked files are rejected", async () =>
  fixture(async (base) => {
    await unlink(join(base, "extensions/example/index.js"));
    await assert.rejects(() => verifySnapshot(base), /inventory differs/);
  }));
test("snapshot directories cannot redirect access through a symlink or junction", async () =>
  fixture(async (base) => {
    await mkdir(join(base, "outside"));
    await symlink(
      join(base, "outside"),
      join(base, "extensions/linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await assert.rejects(() => verifySnapshot(base), /symlink|junction/);
  }));
