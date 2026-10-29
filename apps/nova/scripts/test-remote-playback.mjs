import { build } from "esbuild";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-remote-"));
await build({
  entryPoints: [join(root, "electron/remote-playback.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: join(scratch, "remote.cjs"),
});
const {
  registerRemotePlayback,
  registerDeferredPlayback,
  resolveRemotePlayback,
  remoteLoadOptions,
} = createRequire(import.meta.url)(join(scratch, "remote.cjs"));
after(() => rm(scratch, { recursive: true, force: true }));
test("opaque handles preserve headers/subtitles and reject arbitrary renderer URLs", async () => {
  const remote = {
    url: "https://cdn.example/video.m3u8",
    headers: { Referer: "https://source.example/" },
    subtitles: [
      { url: "https://cdn.example/en.vtt", language: "en", isDefault: true },
    ],
  };
  const locator = registerRemotePlayback(remote);
  assert.match(locator, /^vestra-stream:\/\//);
  assert.deepEqual(await resolveRemotePlayback(locator), remote);
  await assert.rejects(() =>
    resolveRemotePlayback("https://arbitrary.example"),
  );
  let calls = 0;
  const deferred = registerDeferredPlayback(async () => {
    calls++;
    return remote;
  });
  assert.equal(calls, 0);
  await resolveRemotePlayback(deferred);
  await resolveRemotePlayback(deferred);
  assert.equal(calls, 2, "replay must refresh signed URLs");
  assert.deepEqual(remoteLoadOptions(), { headers: [], subtitles: [] });
  assert.throws(() =>
    registerRemotePlayback({
      ...remote,
      headers: { Referer: "bad\r\nInjected: x" },
    }),
  );
});
test(
  "installed mpv loads HLS plus external subtitles with headers and resets options",
  { skip: !process.env.VESTRA_TEST_MPV, timeout: 20000 },
  async () => {
    const wav = Buffer.alloc(44 + 16000);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(16000, 40);
    const seen = [];
    const server = createServer((req, res) => {
      seen.push({ url: req.url, header: req.headers["x-vestra-test"] });
      if (req.headers["x-vestra-test"] !== "required") {
        res.writeHead(403);
        res.end();
        return;
      }
      if (req.url === "/index.m3u8") {
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.end(
          "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1.0,\nsegment.ts\n#EXT-X-ENDLIST\n",
        );
      } else if (req.url === "/en.vtt") {
        res.setHeader("Content-Type", "text/vtt");
        res.end("WEBVTT\n\n00:00.000 --> 00:01.000\nFixture subtitle\n");
      } else {
        res.setHeader("Content-Type", "audio/wav");
        res.end(wav);
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const pipe =
      process.platform === "win32"
        ? `\\\\.\\pipe\\vestra-test-${process.pid}`
        : join(scratch, "mpv.sock");
    const child = spawn(
      process.env.VESTRA_TEST_MPV,
      [
        "--no-config",
        "--idle=yes",
        "--pause=yes",
        "--vo=null",
        "--ao=null",
        "--terminal=no",
        `--input-ipc-server=${pipe}`,
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    let socket;
    const pending = new Map();
    let seq = 0;
    try {
      for (let i = 0; i < 60; i++) {
        try {
          socket = await new Promise((resolve, reject) => {
            const s = connect(pipe);
            s.once("connect", () => resolve(s));
            s.once("error", reject);
          });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      assert.ok(socket, "mpv IPC did not become ready");
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        buffer += chunk;
        let n;
        while ((n = buffer.indexOf("\n")) >= 0) {
          const message = JSON.parse(buffer.slice(0, n));
          buffer = buffer.slice(n + 1);
          const p = pending.get(message.request_id);
          if (p) {
            pending.delete(message.request_id);
            message.error === "success"
              ? p.resolve(message.data)
              : p.reject(new Error(message.error));
          }
        }
      });
      const command = (...args) =>
        new Promise((resolve, reject) => {
          const id = ++seq;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("mpv command timeout"));
          }, 3000);
          pending.set(id, {
            resolve: (v) => {
              clearTimeout(timer);
              resolve(v);
            },
            reject: (e) => {
              clearTimeout(timer);
              reject(e);
            },
          });
          socket.write(
            JSON.stringify({ command: args, request_id: id }) + "\n",
          );
        });
      await command("set_property", "options/http-header-fields", [
        "X-Vestra-Test: required",
      ]);
      await command("set_property", "options/sub-files", [`${base}/en.vtt`]);
      await command("loadfile", `${base}/index.m3u8`, "replace");
      let tracks = [];
      for (let i = 0; i < 60; i++) {
        tracks = await command("get_property", "track-list");
        if (tracks.some((t) => t.type === "sub")) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      assert.ok(
        tracks.some((t) => t.type === "audio"),
        "HLS audio was not decoded",
      );
      assert.ok(
        tracks.some((t) => t.type === "sub"),
        "External subtitle was not loaded",
      );
      for (const path of ["/index.m3u8", "/segment.ts", "/en.vtt"])
        assert.ok(
          seen.some((r) => r.url === path && r.header === "required"),
          `missing authorized ${path}`,
        );
      await command("set_property", "options/http-header-fields", []);
      await command("set_property", "options/sub-files", []);
      assert.deepEqual(
        await command("get_property", "options/http-header-fields"),
        [],
      );
      assert.deepEqual(await command("get_property", "options/sub-files"), []);
    } finally {
      socket?.destroy();
      child.kill();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  },
);
