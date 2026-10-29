import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-subtitles-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: {
    loader: join(root, "apps/nova/electron/mpv/subtitles.ts"),
    remote: join(root, "apps/nova/electron/remote-playback.ts"),
    types: join(root, "packages/extension-host/src/stream-types.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: scratch,
});
const require = createRequire(import.meta.url);
const { ExternalSubtitleLoader } = require(join(scratch, "loader.js"));
const { registerRemotePlayback, resolveRemotePlayback } = require(
  join(scratch, "remote.js"),
);
const { subtitleTrackSchema } = require(join(scratch, "types.js"));
const english = {
  id: "en",
  url: "https://cdn.example/en.vtt",
  language: "en",
  title: "English captions",
  isDefault: true,
};
const french = {
  id: "fr",
  url: "https://cdn.example/fr.vtt",
  language: "fr",
  title: "French",
};
test("subtitle title/language/default survive both host boundaries", async () => {
  const track = subtitleTrackSchema.parse(english);
  const locator = registerRemotePlayback({
    url: "https://cdn.example/video.m3u8",
    headers: {},
    subtitles: [track],
  });
  const result = (await resolveRemotePlayback(locator)).subtitles[0];
  assert.equal(result.title, "English captions");
  assert.equal(result.language, "en");
  assert.equal(result.isDefault, true);
});
test("metadata reaches sub-add, duplicates are suppressed and the declared default is selected last", async () => {
  const loader = new ExternalSubtitleLoader();
  const commands = [];
  const connection = {
    async getProperty() {
      return "video";
    },
    async command(...args) {
      commands.push(args);
    },
  };
  loader.begin("video", [english, french, { ...english, isDefault: false }]);
  assert.deepEqual(await loader.attach(connection), []);
  assert.deepEqual(commands, [
    ["sub-add", french.url, "auto", "French", "fr"],
    ["sub-add", english.url, "select", "English captions", "en"],
  ]);
  await loader.attach(connection);
  assert.equal(commands.length, 2);
});
test("stale file events and cancelled loads cannot attach tracks to a different video", async () => {
  const loader = new ExternalSubtitleLoader();
  let path = "old";
  const commands = [];
  const connection = {
    async getProperty() {
      return path;
    },
    async command(...args) {
      commands.push(args);
    },
  };
  loader.begin("new", [english]);
  await loader.attach(connection);
  assert.equal(commands.length, 0);
  path = "new";
  loader.cancel();
  await loader.attach(connection);
  assert.equal(commands.length, 0);
});
test("subtitle failure is isolated and does not stop remaining tracks", async () => {
  const loader = new ExternalSubtitleLoader();
  const commands = [];
  loader.begin("video", [english, french]);
  const errors = await loader.attach({
    async getProperty() {
      return "video";
    },
    async command(...args) {
      commands.push(args);
      if (args[1] === french.url) throw new Error("loading failed");
    },
  });
  assert.equal(commands.length, 2);
  assert.deepEqual(errors, ["Could not load subtitle: French."]);
});
test("starting another video during a subtitle command suppresses remaining stale tracks", async () => {
  const loader = new ExternalSubtitleLoader();
  const commands = [];
  loader.begin("video", [english, french]);
  await loader.attach({
    async getProperty() {
      return "video";
    },
    async command(...args) {
      commands.push(args);
      loader.begin("next", []);
    },
  });
  assert.equal(commands.length, 1);
});
