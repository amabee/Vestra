/**
 * The isolation boundary, kept behind an interface.
 *
 * Which engine enforces the boundary is an implementation detail that should
 * be replaceable, because the options trade off differently and the right
 * answer may change:
 *
 *   QuickJS (WASM)  A separate VM compiled to WebAssembly. The guest has no
 *                   reference to the host heap at all — isolation comes from
 *                   the WASM sandbox rather than from remembering to remove
 *                   globals. No native build, so packaging stays simple.
 *                   Slower, and a smaller language surface.
 *
 *   isolated-vm     Real V8 isolates. Fast and full-featured, but a native
 *                   module, which means a compile step per platform and per
 *                   Electron ABI.
 *
 *   worker_threads  NOT sufficient on its own. A worker is a concurrency
 *   + node:vm       primitive, not a security one; `node:vm` is explicit in
 *                   its own documentation that it is not a security mechanism,
 *                   and escapes via constructor walking are well known.
 *                   Listed here so nobody reaches for it later thinking it
 *                   was merely overlooked.
 *
 * The default implementation is QuickJS. Nova ships to three platforms and a
 * native module in the packaging path is a recurring cost.
 */

export interface EngineLimits {
  /** Hard ceiling on guest heap. */
  memoryBytes: number;
  /** Wall-clock budget for a single call into the guest. */
  timeoutMs: number;
  /**
   * Interrupt budget, so a `while (true)` is stopped by the engine rather than
   * by a timeout that cannot actually interrupt a blocked thread.
   */
  maxInstructions: number;
}

export const DEFAULT_ENGINE_LIMITS: EngineLimits = {
  memoryBytes: 64 * 1024 * 1024,
  timeoutMs: 10_000,
  maxInstructions: 50_000_000,
};

/**
 * The surface a loaded extension can reach.
 *
 * Assembled per extension from its grant. Methods for ungranted permissions
 * are absent rather than present-and-throwing — an extension cannot call what
 * was never attached, so a forgotten check cannot become an escalation.
 */
export interface HostBridge {
  readonly extensionId: string;
  fetch?: (request: {
    url: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
  }) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  readLibrary?: () => Promise<unknown>;
  readProgress?: () => Promise<unknown>;
  /** Always present. Routed to Vestra's log, tagged with the extension id. */
  log: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

export interface LoadedExtension {
  readonly id: string;
  /**
   * Invoke an exported function inside the guest.
   *
   * Arguments and return values cross the boundary as structured data only.
   * No functions, no prototypes, no host object references — anything else
   * hands the guest a thread back to the host.
   */
  call(method: string, args: readonly unknown[], signal: AbortSignal): Promise<unknown>;
  dispose(): void;
}

export interface ExtensionRuntime {
  /** Identifies the engine in logs and diagnostics, e.g. "quickjs". */
  readonly engine: string;
  /**
   * The grant is not passed here on purpose: `bridge` already is the grant,
   * materialised. Handing the engine both would create two sources of truth
   * for what an extension may do, and the one that gets enforced would be
   * whichever the engine happened to consult.
   */
  load(input: {
    extensionId: string;
    /** Extension source. Already fetched, integrity-checked and pinned. */
    source: string;
    bridge: HostBridge;
    limits?: EngineLimits;
  }): Promise<LoadedExtension>;
  /** Tear down every isolate. Called on app quit. */
  disposeAll(): void;
}

export class EngineUnavailableError extends Error {
  constructor(engine: string) {
    super(
      `The "${engine}" extension engine is not installed. ` +
        "Community extensions stay disabled until an isolate is available — " +
        "running them in-process is not an acceptable fallback.",
    );
    this.name = "EngineUnavailableError";
  }
}

/**
 * Stand-in used until an engine is wired up.
 *
 * Deliberately a hard failure. The tempting shortcut when the sandbox is not
 * ready yet is to run extensions directly "just for now", which quietly
 * deletes the boundary this package exists to provide.
 */
export function createUnavailableRuntime(engine = "quickjs"): ExtensionRuntime {
  return {
    engine,
    load: () => Promise.reject(new EngineUnavailableError(engine)),
    disposeAll: () => undefined,
  };
}
