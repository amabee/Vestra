// Throwaway probe of mpv's JSON IPC, used to validate the assumptions in
// apps/nova/electron/mpv/connection.ts before trusting them inside Electron.
const { spawn } = require("node:child_process");
const { connect } = require("node:net");
const { randomBytes } = require("node:crypto");

const MPV = ".tools\\mpv\\mpv.exe";
const FILE = process.argv[2];

const pipe = `\\\\.\\pipe\\vestra-mpv-test-${randomBytes(6).toString("hex")}`;

const child = spawn(
  MPV,
  [
    `--input-ipc-server=${pipe}`,
    "--idle=yes",
    "--force-window=no",
    "--vo=null",
    "--ao=null",
    "--no-config",
    "--no-terminal",
    "--keep-open=yes",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

let stderr = "";
child.stderr.on("data", (b) => (stderr += b.toString()));

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function openSocket(attempts = 40) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = connect(pipe);
        socket.once("error", (e) => {
          socket.destroy();
          reject(e);
        });
        socket.once("connect", () => resolve(socket));
      });
    } catch {
      await delay(50);
    }
  }
  throw new Error("could not connect");
}

(async () => {
  const t0 = Date.now();
  const socket = await openSocket();
  console.log(`CONNECTED after ${Date.now() - t0}ms`);

  socket.setEncoding("utf8");

  let nextId = 1;
  const pending = new Map();
  const events = [];
  let buffer = "";

  socket.on("data", (chunk) => {
    buffer += chunk;
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) {
        const msg = JSON.parse(line);
        if (typeof msg.request_id === "number") {
          const p = pending.get(msg.request_id);
          if (p) {
            pending.delete(msg.request_id);
            p(msg);
          }
        } else if (msg.event) {
          events.push(msg);
        }
      }
      nl = buffer.indexOf("\n");
    }
  });

  const command = (...args) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.write(`${JSON.stringify({ command: args, request_id: id })}\n`);
    });

  console.log("VERSION:", (await command("get_property", "mpv-version")).data);

  // Observe the same properties the real session does.
  for (const [id, name] of [
    [1, "time-pos"],
    [2, "duration"],
    [3, "pause"],
    [6, "track-list"],
  ]) {
    const r = await command("observe_property", id, name);
    if (r.error !== "success") console.log(`OBSERVE ${name} =>`, r.error);
  }

  console.log("LOADING:", FILE);
  console.log("LOADFILE:", (await command("loadfile", FILE, "replace")).error);

  await delay(2500);

  const duration = (await command("get_property", "duration")).data;
  const tracks = (await command("get_property", "track-list")).data;

  console.log("DURATION:", duration);
  console.log(
    "TRACKS:",
    (tracks ?? []).map((t) => `${t.type}#${t.id} ${t.codec ?? ""} ${t.lang ?? ""}${t.selected ? " *" : ""}`),
  );

  await command("set_property", "pause", true);
  await command("seek", 60, "absolute");
  await delay(800);
  console.log("AFTER SEEK time-pos:", (await command("get_property", "time-pos")).data);

  const names = [...new Set(events.map((e) => e.event))];
  console.log("EVENTS SEEN:", names.join(", "));
  console.log(
    "PROPERTY-CHANGES:",
    [...new Set(events.filter((e) => e.event === "property-change").map((e) => e.name))].join(", "),
  );

  socket.destroy();
  child.kill();
  if (stderr.trim()) console.log("STDERR:", stderr.trim().slice(0, 300));
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e.message);
  console.error("STDERR:", stderr.slice(0, 500));
  child.kill();
  process.exit(1);
});
