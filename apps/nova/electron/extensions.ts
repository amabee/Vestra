import { join } from "node:path";

import { createBrokeredFetch, type GuardedTransport } from "@vestra/extension-host/net";
import type { PermissionGrant } from "@vestra/extension-host/permissions";
import { listInstalled, readSource } from "@vestra/extension-host/store";
import type { InstalledExtension } from "@vestra/extension-host/install";
import { NodeDriver } from "@vestra/storage";
import { utilityProcess, type UtilityProcess } from "electron";

import { safeFetch } from "./safe-fetch";

/**
 * Extension manager.
 *
 * Owns the worker that runs extension isolates, and keeps every decision the
 * worker is not trusted to make on this side of the boundary:
 *
 *   - the permission grant, and therefore which capabilities exist at all
 *   - the per-extension host allowlist and rate limits
 *   - the actual network call
 *
 * The worker asks; this answers. A compromised worker gains no reach it was
 * not already granted, because the grant is never evaluated there.
 */

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface Loaded {
  grant: PermissionGrant;
  fetcher: ReturnType<typeof createBrokeredFetch>;
}

let worker: UtilityProcess | null = null;
let sequence = 0;

const pending = new Map<string, Pending>();
const loaded = new Map<string, Loaded>();

/**
 * The real network call, made from the privileged process.
 *
 * Everything goes through `safeFetch`, which refuses anything that is not
 * https and anything resolving to a loopback, private, link-local or
 * carrier-grade-NAT address. Extension code has already passed the per-host
 * allowlist in `createBrokeredFetch` by the time it reaches here; this is the
 * backstop for what that allowlist cannot know, and the same guard covers
 * registry and manifest fetches during an install.
 */
export const transport: GuardedTransport = {
  async request({ url, method, headers, body, timeoutMs, maxBytes }) {
    return safeFetch({ url, method, headers, body, timeoutMs, maxBytes });
  },
};

function ensureWorker(): UtilityProcess {
  if (worker) return worker;

  const child = utilityProcess.fork(join(__dirname, "extension-worker.js"), [], {
    // No Electron APIs, no window, no privileged surface.
    serviceName: "vestra-extensions",
    stdio: "pipe",
  });

  child.on("message", (message: unknown) => {
    void handleWorkerMessage(message);
  });

  child.on("exit", () => {
    worker = null;
    for (const [, entry] of pending) {
      entry.reject(new Error("The extension worker stopped."));
    }
    pending.clear();
    loaded.clear();
  });

  worker = child;
  return child;
}

async function handleWorkerMessage(message: unknown): Promise<void> {
  if (typeof message !== "object" || message === null || !("kind" in message)) return;

  const payload = message as { kind: string; [key: string]: unknown };

  if (payload.kind === "result") {
    const entry = pending.get(String(payload.id));
    if (!entry) return;
    pending.delete(String(payload.id));

    if (payload.ok === true) entry.resolve(payload.value);
    else entry.reject(new Error(String(payload.error ?? "Extension call failed.")));
    return;
  }

  if (payload.kind === "log") {
    console.info(`[extension:${String(payload.extensionId)}]`, String(payload.message));
    return;
  }

  if (payload.kind === "fetch") {
    const id = String(payload.id);
    const extensionId = String(payload.extensionId);
    const entry = loaded.get(extensionId);

    try {
      if (!entry?.fetcher) {
        throw new Error("This extension was not granted network access.");
      }

      const request = payload.request as { url: string; method?: "GET" | "POST" };
      const value = await entry.fetcher({ ...request, url: request.url });
      worker?.postMessage({ kind: "fetch-result", id, ok: true, value });
    } catch (error) {
      worker?.postMessage({
        kind: "fetch-result",
        id,
        ok: false,
        error: error instanceof Error ? error.message : "Request failed.",
      });
    }
  }
}

function send(message: Record<string, unknown>): Promise<unknown> {
  const child = ensureWorker();
  const id = `req-${(sequence += 1)}`;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.postMessage({ ...message, id });
  });
}

export async function loadExtension(input: {
  extensionId: string;
  source: string;
  grant: PermissionGrant;
}): Promise<string[]> {
  // The fetcher is built here, from the grant, and stays here. The worker only
  // ever receives the outcome of a request it asked for.
  loaded.set(input.extensionId, {
    grant: input.grant,
    fetcher: createBrokeredFetch(input.grant, transport),
  });

  try {
    const result = await send({
      kind: "load",
      extensionId: input.extensionId,
      source: input.source,
      grant: input.grant,
    });

    const methods = (result as { methods?: unknown })?.methods;
    return Array.isArray(methods) ? methods.filter((m) => typeof m === "string") : [];
  } catch (error) {
    loaded.delete(input.extensionId);
    throw error;
  }
}

export function callExtension(
  extensionId: string,
  method: string,
  args: unknown[],
): Promise<unknown> {
  return send({ kind: "call", extensionId, method, args });
}

export async function unloadExtension(extensionId: string): Promise<void> {
  loaded.delete(extensionId);
  if (worker) await send({ kind: "unload", extensionId });
}

export function listLoadedExtensions(): string[] {
  return [...loaded.keys()];
}

export interface StartupReport {
  loaded: string[];
  skipped: { id: string; reason: string }[];
  /** Exported methods per extension, for whoever decides what to do with them. */
  methods: Record<string, string[]>;
  /** The records that loaded, so callers need not re-read the store. */
  records: InstalledExtension[];
}

/**
 * Load every installed extension at startup.
 *
 * `readSource` re-verifies the stored fingerprint, so a payload that was
 * altered on disk since install yields null and the extension is skipped
 * rather than run. One bad extension never stops the others — this returns a
 * report instead of throwing.
 */
export async function loadInstalledExtensions(dataDir: string): Promise<StartupReport> {
  const driver = new NodeDriver(dataDir);
  const report: StartupReport = { loaded: [], skipped: [], methods: {}, records: [] };

  let records;
  try {
    records = await listInstalled(driver);
  } catch {
    return report;
  }

  for (const record of records) {
    try {
      const source = await readSource(driver, record);

      if (source === null) {
        report.skipped.push({
          id: record.id,
          reason: "Stored code does not match the fingerprint recorded at install.",
        });
        continue;
      }

      const methods = await loadExtension({
        extensionId: record.id,
        source,
        grant: record.grant,
      });

      report.loaded.push(record.id);
      report.methods[record.id] = methods;
      report.records.push(record);
    } catch (error) {
      report.skipped.push({
        id: record.id,
        reason: error instanceof Error ? error.message : "Failed to load.",
      });
    }
  }

  return report;
}

/** Called on quit. Killing the worker disposes every isolate with it. */
export function stopExtensionWorker(): void {
  worker?.kill();
  worker = null;
  pending.clear();
  loaded.clear();
}
