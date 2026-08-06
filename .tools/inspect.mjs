// Inspect Nova's renderer over the DevTools Protocol.
//
// Reading the running UI directly, rather than inferring its state from
// terminal output. Requires the app started with a debugging port:
//
//   pnpm --filter @vestra/nova start:debug
//
// Usage:
//   node .tools/inspect.mjs "document.querySelectorAll('button').length"
//   node .tools/inspect.mjs --target overlay "document.body.innerText"
//   node .tools/inspect.mjs --console
//   node .tools/inspect.mjs --targets
//
// Node 22 ships WebSocket, so this needs nothing installed.

const PORT = process.env.VESTRA_DEBUG_PORT ?? "9222";
const BASE = `http://127.0.0.1:${PORT}`;

const args = process.argv.slice(2);

const wantTargets = args.includes("--targets");
const wantConsole = args.includes("--console");

const targetIndex = args.indexOf("--target");
const targetMatch = targetIndex === -1 ? null : args[targetIndex + 1];

// The value after --target is consumed by it, not the expression. Guard the
// -1 case: without it, index 0 would be skipped and a bare expression lost.
const consumedIndex = targetIndex === -1 ? -1 : targetIndex + 1;

const expression = args.filter(
  (arg, index) => !arg.startsWith("--") && index !== consumedIndex,
)[0];

const targets = await listTargets();

if (wantTargets || (!expression && !wantConsole)) {
  for (const target of targets) {
    console.log(`[${target.type}] ${target.title}\n    ${target.url}`);
  }
  if (!wantTargets) {
    console.log("\nPass an expression, --console, or --target <name> <expression>.");
  }
  process.exit(0);
}

// Default to the main window; "overlay" selects the controls window, which
// only exists while something is playing.
const target =
  targets.find((entry) =>
    targetMatch
      ? entry.url.includes(targetMatch) ||
        entry.title.toLowerCase().includes(targetMatch.toLowerCase())
      : entry.url.includes("index.html"),
  ) ?? targets[0];

if (!target) {
  console.error("No page target found. Is the app running with a debug port?");
  process.exit(1);
}

console.log(`target: ${target.title} (${target.url.split("/").pop()})\n`);

const socket = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);

  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }

  // Console output and uncaught exceptions, as they happen.
  if (message.method === "Runtime.consoleAPICalled") {
    const text = message.params.args
      .map((arg) => arg.value ?? arg.description ?? arg.type)
      .join(" ");
    console.log(`  [${message.params.type}] ${text}`);
  }

  if (message.method === "Runtime.exceptionThrown") {
    const details = message.params.exceptionDetails;
    console.log(`  [error] ${details.text} ${details.exception?.description ?? ""}`);
  }
});

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("could not connect")), {
    once: true,
  });
});

await send("Runtime.enable");

if (wantConsole) {
  console.log("Listening for console output and exceptions. Ctrl+C to stop.\n");
  // Deliberately never resolves; the message handler above does the printing.
  await new Promise(() => {});
}

const response = await send("Runtime.evaluate", {
  expression,
  returnByValue: true,
  awaitPromise: true,
  // Lets expressions use top-level await and reach the same globals as the app.
  replMode: true,
});

const result = response.result;

if (result?.exceptionDetails) {
  console.error("threw:", result.exceptionDetails.text);
  const description = result.exceptionDetails.exception?.description;
  if (description) console.error(description);
  process.exit(1);
}

const value = result?.result?.value;
console.log(typeof value === "object" ? JSON.stringify(value, null, 2) : String(value));

socket.close();
process.exit(0);

async function listTargets() {
  try {
    const response = await fetch(`${BASE}/json/list`);
    const all = await response.json();
    return all.filter((entry) => entry.type === "page");
  } catch {
    console.error(
      `Could not reach ${BASE}. Start the app with:\n` +
        "  pnpm --filter @vestra/nova start:debug",
    );
    process.exit(1);
  }
}
