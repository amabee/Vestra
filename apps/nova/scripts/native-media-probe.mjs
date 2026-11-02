import assert from "node:assert/strict";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { sourceRoot } from "./native-source-live-runtime.mjs";

export async function probeMpv(video) {
  const pipe = `\\\\.\\pipe\\vestra-media-${process.pid}-${Date.now()}`;
  const child = spawn(
    join(sourceRoot, "apps/nova/vendor/mpv/mpv.exe"),
    [
      "--no-config",
      "--vo=null",
      "--ao=null",
      "--force-window=no",
      "--terminal=no",
      "--idle=yes",
      "--cache=yes",
      "--cache-secs=3",
      "--demuxer-max-bytes=16MiB",
      "--network-timeout=15",
      "--hls-bitrate=max",
      `--input-ipc-server=${pipe}`,
      `--referrer=${video.headers?.Referer ?? ""}`,
    ],
    { windowsHide: true, stdio: "ignore" },
  );
  let socket, failure;
  child.once("error", () => {
    failure = "Could not start bundled mpv";
  });
  const pending = new Map();
  const guard = setTimeout(() => {
    failure = "mpv bounded playback timed out";
    child.kill();
    socket?.destroy();
  }, 55000);
  try {
    for (let index = 0; index < 100 && !socket; index++) {
      if (failure) throw Error(failure);
      try {
        socket = await new Promise((resolve, reject) => {
          const candidate = connect(pipe);
          candidate.once("connect", () => resolve(candidate));
          candidate.once("error", (error) => {
            candidate.destroy();
            reject(error);
          });
        });
      } catch {
        await delay(50);
      }
    }
    if (!socket) throw Error("mpv IPC did not become ready");
    let buffer = "",
      sequence = 0;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        const entry = pending.get(message.request_id);
        if (entry) {
          pending.delete(message.request_id);
          clearTimeout(entry.timer);
          message.error === "success"
            ? entry.resolve(message.data)
            : entry.reject(Error("mpv property unavailable"));
        }
      }
    });
    const command = (...args) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("mpv IPC command timed out"));
        }, 3000);
        pending.set(id, { resolve, reject, timer });
        socket.write(JSON.stringify({ command: args, request_id: id }) + "\n");
      });
    await command("loadfile", video.url);
    for (let index = 0; index < 180; index++) {
      if (failure) throw Error(failure);
      const position = await command("get_property", "time-pos").catch(
        () => null,
      );
      if (typeof position === "number" && position >= 2) {
        if (video.subtitles?.[0]?.url)
          await command("sub-add", video.subtitles[0].url, "auto");
        const tracks = await command("get_property", "track-list");
        const videoTrack = tracks.find((track) => track.type === "video");
        const audioTrack = tracks.find((track) => track.type === "audio");
        assert.ok(videoTrack && audioTrack, "mpv must expose video and audio");
        return {
          videoCodec: videoTrack.codec,
          audioCodec: audioTrack.codec,
          tracks: tracks.length,
          subtitleTracks: tracks.filter((track) => track.type === "sub").length,
          playedSeconds: Math.floor(position),
        };
      }
      await delay(250);
    }
    throw Error("mpv did not advance playback");
  } finally {
    clearTimeout(guard);
    for (const entry of pending.values()) clearTimeout(entry.timer);
    socket?.destroy();
    child.kill();
  }
}
