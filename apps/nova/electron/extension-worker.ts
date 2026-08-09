import { createHostBridge } from "@vestra/extension-host/bridge";
import { createQuickJSRuntime } from "@vestra/extension-host/quickjs";
import type { GuardedTransport } from "@vestra/extension-host/net";
import type { PermissionGrant } from "@vestra/extension-host/permissions";
import type { LoadedExtension } from "@vestra/extension-host/engine";

/**
 * Extension worker.
 *
 * Runs as an Electron `utilityProcess`, which is a plain Node process with no
 * Electron APIs, no window, and no access to the app's privileged surface.
 * Extension isolates live here rather than in the main process.
 *
 * That is defence in depth, not redundancy. The QuickJS WASM boundary is the
 * primary control and it is a strong one, but the main process is the most
 * privileged process in an Electron app — if that boundary ever failed, the
 * blast radius should be a disposable child process, not the thing that owns
 * the window, the tray and the filesystem.
 *
 * The worker never opens a socket itself. Network requests are relayed to the
 * parent, which owns the SSRF guard and the per-extension host allowlist.
 */

type Incoming =
  | { kind: "load"; id: string; extensionId: string; source: string; grant: PermissionGrant }
  | { kind: "call"; id: string; extensionId: string; method: string; args: unknown[] }
  | { kind: "unload"; id: string; extensionId: string }
  | { kind: "fetch-result"; id: string; ok: true; value: unknown }
  | { kind: "fetch-result"; id: string; ok: false; error: string };

type Outgoing =
  | { kind: "result"; id: string; ok: true; value: unknown }
  | { kind: "result"; id: string; ok: false; error: string }
  | { kind: "fetch"; id: string; extensionId: string; request: unknown }
  | { kind: "log"; extensionId: string; level: string; message: string };

const runtime = createQuickJSRuntime();
const loaded = new Map<string, LoadedExtension>();

/** Host calls relayed to the parent, keyed by request id. */
const pendingRelays = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();

let relaySequence = 0;

function send(message: Outgoing): void {
  process.parentPort?.postMessage(message);
}

/**
 * Network transport that does not touch the network.
 *
 * Everything is relayed to the parent, so the worker holds no ability to make
 * a request of its own — an extension that somehow escaped its isolate would
 * still find nothing here to call.
 */
function relayTransport(extensionId: string): GuardedTransport {
  return {
    request: (input) =>
      new Promise((resolve, reject) => {
        const id = `relay-${(relaySequence += 1)}`;
        pendingRelays.set(id, {
          resolve: (value) =>
            resolve(value as { status: number; headers: Record<string, string>; body: string }),
          reject,
        });
        send({ kind: "fetch", id, extensionId, request: input });
      }),
  };
}

async function handleLoad(message: Extract<Incoming, { kind: "load" }>): Promise<unknown> {
  loaded.get(message.extensionId)?.dispose();
  loaded.delete(message.extensionId);

  const bridge = createHostBridge(message.grant, {
    transport: relayTransport(message.extensionId),
    // Library and progress reads are not relayed yet — granting them would be
    // a lie until the parent implements them, and a capability that silently
    // returns nothing is worse than one that is absent.
    readLibrary: () => Promise.reject(new Error("Library access is not available yet.")),
    readProgress: () => Promise.reject(new Error("Progress access is not available yet.")),
    log: (extensionId, level, text) =>
      send({ kind: "log", extensionId, level, message: text }),
  });

  const instance = await runtime.load({
    extensionId: message.extensionId,
    source: message.source,
    bridge,
  });

  loaded.set(message.extensionId, instance);

  // Asked once, here, while the isolate is warm. The parent needs it to decide
  // whether this extension can be offered as a search provider.
  const methods = await instance.listMethods(AbortSignal.timeout(30_000));

  return { loaded: true, methods };
}

async function handleCall(message: Extract<Incoming, { kind: "call" }>): Promise<unknown> {
  const instance = loaded.get(message.extensionId);
  if (!instance) throw new Error(`Extension "${message.extensionId}" is not loaded.`);

  // The isolate enforces its own deadline; this is the outer bound.
  return instance.call(message.method, message.args, AbortSignal.timeout(30_000));
}

process.parentPort?.on("message", (event) => {
  const message = event.data as Incoming;

  if (message.kind === "fetch-result") {
    const pending = pendingRelays.get(message.id);
    if (!pending) return;
    pendingRelays.delete(message.id);

    if (message.ok) pending.resolve(message.value);
    else pending.reject(new Error(message.error));
    return;
  }

  void (async () => {
    try {
      let value: unknown;

      switch (message.kind) {
        case "load":
          value = await handleLoad(message);
          break;
        case "call":
          value = await handleCall(message);
          break;
        case "unload":
          loaded.get(message.extensionId)?.dispose();
          loaded.delete(message.extensionId);
          value = { unloaded: true };
          break;
      }

      send({ kind: "result", id: message.id, ok: true, value });
    } catch (error) {
      send({
        kind: "result",
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : "Extension call failed.",
      });
    }
  })();
});
