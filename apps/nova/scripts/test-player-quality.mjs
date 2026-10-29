import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-player-quality-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: [join(nova, "renderer/src/lib/player-store.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "player.cjs"),
});
const { usePlayer } = createRequire(import.meta.url)(
  join(scratch, "player.cjs"),
);
test("quality override keeps queue identity, resets between titles and preserves explicit resume", () => {
  const queue = [
    { locator: "vestra-stream://episode", kind: "stream" },
    { locator: "vestra-stream://next", kind: "stream" },
  ];
  usePlayer
    .getState()
    .open({ title: "Fixture" }, queue, 0, 42, {
      [queue[0].locator]: "vestra-stream://quality",
    });
  assert.equal(usePlayer.getState().queue[0].locator, queue[0].locator);
  assert.equal(
    usePlayer.getState().renditionOverrides[queue[0].locator],
    "vestra-stream://quality",
  );
  assert.equal(usePlayer.getState().startAt, 42);
  usePlayer.getState().next();
  assert.equal(
    usePlayer.getState().renditionOverrides[queue[1].locator],
    undefined,
  );
  usePlayer.getState().open({ title: "Other" }, queue);
  assert.deepEqual(usePlayer.getState().renditionOverrides, {});
  usePlayer.getState().close();
  assert.deepEqual(usePlayer.getState().renditionOverrides, {});
});
