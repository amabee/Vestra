// Dump an mpv property for a file, over the same JSON IPC the app uses.
//
//   node .tools/mpv-property.mjs <file> chapter-list [--chapters-file=<path>]
//
// The formatted property expansion (--term-playing-msg) and the JSON IPC do
// NOT agree on types: `${chapter-list/0/time}` prints "00:01:55" while the IPC
// returns 115.0. Parsers consume the latter, so check shapes here rather than
// inferring them from terminal output.

import { spawn } from "node:child_process";
import { connect } from "node:net";
import { randomBytes } from "node:crypto";

const [file, property = "chapter-list", ...rest] = process.argv.slice(2);

if (!file) {
  console.error("usage: node mpv-property.mjs <file> [property] [--mpv-flag ...]");
  process.exit(1);
}

const MPV = "apps/nova/vendor/mpv/mpv.exe";
const pipe = `\\\\.\\pipe\\vestra-probe-${randomBytes(6).toString("hex")}`;

const child = spawn(
  MPV,
  [
    file,
    "--no-config",
    "--idle=yes",
    "--vo=null",
    "--ao=null",
    "--pause=yes",
    `--input-ipc-server=${pipe}`,
    ...rest,
  ],
  { stdio: "ignore" },
);

// mpv creates the socket shortly after spawn, not at exec.
const socket = await new Promise((resolve, reject) => {
  let attempts = 0;
  const tryConnect = () => {
    const candidate = connect(pipe);
    candidate.once("connect", () => resolve(candidate));
    candidate.once("error", () => {
      if (++attempts > 40) return reject(new Error("mpv IPC never appeared"));
      setTimeout(tryConnect, 50);
    });
  };
  tryConnect();
});

let buffer = "";
const pending = new Map();

socket.on("data", (chunk) => {
  buffer += chunk.toString();
  let index;
  while ((index = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (!line.trim()) continue;

    const message = JSON.parse(line);
    if (message.request_id !== undefined && pending.has(message.request_id)) {
      pending.get(message.request_id)(message);
      pending.delete(message.request_id);
    }
  }
});

let nextId = 1;
const command = (...args) =>
  new Promise((resolve) => {
    const request_id = nextId++;
    pending.set(request_id, resolve);
    socket.write(`${JSON.stringify({ command: args, request_id })}\n`);
  });

// Give the file a moment to load before asking about its contents.
await new Promise((resolve) => setTimeout(resolve, 1200));

const result = await command("get_property", property);

console.log(JSON.stringify(result.data, null, 1));
console.log("\ntypes:");
if (Array.isArray(result.data) && result.data[0]) {
  for (const [key, value] of Object.entries(result.data[0])) {
    console.log(`  ${key}: ${typeof value}`);
  }
}

socket.end();
child.kill();
