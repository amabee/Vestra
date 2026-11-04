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
    contents: `export * from './shared/playback-errors';export {bridge} from './renderer/src/lib/bridge';export {problemReportUrl} from './renderer/src/lib/problem-report';`,
    resolveDir: nova,
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "test.cjs"),
});
const {
  bridge,
  playbackIssue,
  playbackFailureReply,
  unwrapPlaybackReply,
  problemReportUrl,
} = createRequire(import.meta.url)(join(scratch, "test.cjs"));
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
      "This provider has no exact match for this title and release year. Try another provider.",
      "title-match",
    ],
    [
      "Multiple source editions match this title. Choose a title in source search.",
      "title-match",
    ],
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

test("GitHub reports use a fixed issue draft and never include raw errors or credentials", () => {
  const url = new URL(
    problemReportUrl(
      {
        area: "Source matching",
        source: "ext-vestra-kisskh",
        error: Error(
          "https://private.example/video?token=secret C:\\Users\\private\\file Authorization: Bearer secret",
        ),
      },
      "0.2.5",
      "win32",
    ),
  );
  assert.equal(
    url.origin + url.pathname,
    "https://github.com/amabee/Vestra/issues/new",
  );
  assert.equal(
    url.searchParams.get("title"),
    "[Bug] Source matching (ext-vestra-kisskh)",
  );
  const body = url.searchParams.get("body");
  assert.match(body, /Nova: 0.2.5/);
  assert.match(body, /Platform: win32/);
  assert.match(body, /Error code: unknown/);
  assert.doesNotMatch(
    body,
    /private\.example|Users|secret|Authorization|Bearer|token=/,
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
