import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-playback-errors-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  stdin: {
    contents: `export * from './shared/playback-errors';export {bridge} from './renderer/src/lib/bridge';`,
    resolveDir: nova,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
});
const { bridge, playbackIssue, playbackFailureReply, unwrapPlaybackReply } =
  createRequire(import.meta.url)(join(scratch, "test.cjs"));
test("provider details and arbitrary errors never leak through playback replies", () => {
  for (const [raw, code] of [
    [
      "No playable mirror was available. Sub: C# provider worker stopped.",
      "interrupted",
    ],
    ["C# provider worker exited (1).", "interrupted"],
    ["C# provider operation exceeded its deadline.", "timeout"],
    ["fetch failed ECONNRESET", "network"],
    [
      "No scraper implemented for embed host: https://secret.example/token",
      "unavailable",
    ],
    ["unexpected private failure https://secret.example/token", "unknown"],
  ]) {
    const reply = playbackFailureReply(Error(raw));
    assert.deepEqual(reply, { playbackFailure: code });
    assert.throws(
      () => unwrapPlaybackReply(reply),
      (error) => {
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, /C#|secret|token|ECONN|deadline/);
        assert.equal(playbackIssue(error.message).code, code);
        return true;
      },
    );
  }
  assert.throws(
    () => unwrapPlaybackReply({ playbackFailure: "toString" }),
    /Try again/,
  );
});
test("renderer bridge preserves successful replies and unwraps each playback failure", async () => {
  let reply = [{ locator: "fixture", label: "1080p" }];
  globalThis.window = {
    vestra: {
      media: {
        streamQualities: async () => reply,
        resolvePlayback: async () => reply,
      },
      mpv: { open: async () => reply },
    },
  };
  try {
    for (const call of [
      () => bridge.media.streamQualities("fixture"),
      () => bridge.media.resolvePlayback({}),
      () => bridge.mpv.open({}),
    ]) {
      const success = reply;
      assert.equal(await call(), success);
      reply = playbackFailureReply(Error("C# provider worker stopped."));
      await assert.rejects(
        call(),
        (error) =>
          error.name === "PlaybackFailure" && error.code === "interrupted",
      );
      reply = success;
    }
  } finally {
    delete globalThis.window;
  }
});
