import {
  newQuickJSWASMModule,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten";

import {
  DEFAULT_ENGINE_LIMITS,
  type EngineLimits,
  type ExtensionRuntime,
  type HostBridge,
  type LoadedExtension,
} from "./engine";

/**
 * QuickJS isolate.
 *
 * The guest runs in a separate VM compiled to WebAssembly. It has no reference
 * to the host heap, no module resolver beyond the one installed below, and no
 * globals except the ones put there deliberately — isolation comes from the
 * WASM boundary rather than from remembering to delete things.
 *
 * ONLY JSON STRINGS CROSS THE NATIVE BOUNDARY. Every host function takes and
 * returns a string and the guest-side shim does the parsing, which makes the
 * "plain data only" rule structural instead of a convention: there is no code
 * path that could pass a function, a prototype or a host object reference,
 * because the boundary only speaks text.
 *
 * Async host calls use `newPromise` rather than the ASYNCIFY build. Asyncified
 * functions leak a host reference that makes `JS_FreeRuntime` abort, so an app
 * that loaded and unloaded extensions would leak an entire VM each time. This
 * approach also avoids the asyncify performance overhead.
 */

/** Module specifier the guest uses to reach its own code. */
const EXTENSION_SPECIFIER = "vestra:extension";

/**
 * Guest-side shim.
 *
 * Wraps the raw native functions into the ergonomic `host` object the contract
 * promises, and exposes a uniform invoke entry point. Deliberately small — it
 * runs inside the isolate and is the only host-authored code the guest sees.
 */
const BOOTSTRAP = `
import * as extension from ${JSON.stringify(EXTENSION_SPECIFIER)};

// Native calls reject with a plain string, because only strings cross. Rethrow
// as a real Error so extension authors can catch what they expect to catch.
function lift(nativeCall) {
  return async (...args) => {
    try {
      return JSON.parse(await nativeCall(...args));
    } catch (reason) {
      throw new Error(typeof reason === "string" ? reason : String((reason && reason.message) || reason));
    }
  };
}

const host = { log: (level, message) => __nativeLog(String(level), String(message)) };

if (typeof __nativeFetch === "function") {
  const call = lift(__nativeFetch);
  host.fetch = (request) => call(JSON.stringify(request ?? {}));
}
if (typeof __nativeReadLibrary === "function") {
  host.readLibrary = lift(__nativeReadLibrary);
}
if (typeof __nativeReadProgress === "function") {
  host.readProgress = lift(__nativeReadProgress);
}

let activated = null;

async function exportsOf() {
  if (activated === null) {
    if (typeof extension.activate !== "function") {
      throw new Error("Extension does not export an activate() function.");
    }
    const result = await extension.activate({ host, manifest: __manifest });
    if (result === null || typeof result !== "object") {
      throw new Error("activate() must return an object of methods.");
    }
    activated = result;
  }
  return activated;
}

globalThis.__vestra = {
  async methods() {
    const api = await exportsOf();
    return JSON.stringify(Object.keys(api).filter((key) => typeof api[key] === "function"));
  },
  async invoke(method, argsJson) {
    const api = await exportsOf();
    const fn = api[method];
    if (typeof fn !== "function") throw new Error("No such method: " + method);
    const value = await fn(...JSON.parse(argsJson));
    return JSON.stringify(value === undefined ? null : value);
  },
};
`;

export class ExtensionExecutionError extends Error {
  constructor(
    readonly extensionId: string,
    message: string,
  ) {
    super(message);
    this.name = "ExtensionExecutionError";
  }
}

/**
 * One WASM module, many runtimes.
 *
 * Instantiating the module is the expensive part and it is stateless. Each
 * extension still gets its own runtime, which is where the isolation boundary
 * actually sits — runtimes do not share a heap.
 */
let modulePromise: Promise<QuickJSWASMModule> | null = null;

function getModule(): Promise<QuickJSWASMModule> {
  modulePromise ??= newQuickJSWASMModule();
  return modulePromise;
}

interface Instance {
  runtime: QuickJSRuntime;
  context: QuickJSContext;
  /** Set while a call is in flight; the interrupt handler enforces it. */
  deadline: number | null;
  disposed: boolean;
}

export function createQuickJSRuntime(): ExtensionRuntime {
  const instances = new Set<Instance>();

  async function load(input: {
    extensionId: string;
    source: string;
    bridge: HostBridge;
    limits?: EngineLimits;
  }): Promise<LoadedExtension> {
    const limits = input.limits ?? DEFAULT_ENGINE_LIMITS;
    const runtime = (await getModule()).newRuntime();

    const instance: Instance = {
      runtime,
      context: runtime.newContext(),
      deadline: null,
      disposed: false,
    };

    runtime.setMemoryLimit(limits.memoryBytes);

    // Wall clock, not an instruction count. A guest stuck in a loop cannot be
    // interrupted by a timer, so the check has to ride on the guest's own
    // execution ticks — which is exactly what this callback is.
    runtime.setInterruptHandler(() => {
      if (instance.deadline === null) return false;
      return Date.now() > instance.deadline;
    });

    // The only module the guest can resolve. Anything else fails to load
    // rather than reaching a filesystem or a network.
    runtime.setModuleLoader((moduleName) =>
      moduleName === EXTENSION_SPECIFIER
        ? input.source
        : { error: new Error(`Cannot resolve module "${moduleName}".`) },
    );

    const { context } = instance;

    try {
      installHostFunctions(instance, input.bridge);

      const manifestHandle = context.newString(JSON.stringify({ id: input.extensionId }));
      context.setProp(context.global, "__manifestJson", manifestHandle);
      manifestHandle.dispose();

      // Parsed guest-side so the guest owns its object rather than sharing one.
      evalGuest(instance, "globalThis.__manifest = JSON.parse(__manifestJson);", "prelude");
      evalGuest(instance, BOOTSTRAP, "vestra:bootstrap", true);
    } catch (error) {
      disposeInstance(instance);
      throw new ExtensionExecutionError(
        input.extensionId,
        error instanceof Error ? error.message : "Failed to load extension.",
      );
    }

    instances.add(instance);

    return {
      id: input.extensionId,

      async listMethods(signal) {
        if (instance.disposed) {
          throw new ExtensionExecutionError(
            input.extensionId,
            "Extension has been unloaded.",
          );
        }

        const raw = await callBootstrap(
          instance,
          input.extensionId,
          "methods",
          [],
          "activate",
          limits.timeoutMs,
          signal,
        );

        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
      },

      async call(method, args, signal) {
        if (instance.disposed) {
          throw new ExtensionExecutionError(input.extensionId, "Extension has been unloaded.");
        }

        const raw = await invoke(
          instance,
          input.extensionId,
          method,
          JSON.stringify(args),
          limits.timeoutMs,
          signal,
        );

        try {
          return JSON.parse(raw) as unknown;
        } catch {
          throw new ExtensionExecutionError(
            input.extensionId,
            `${method}() returned a value that could not be serialised.`,
          );
        }
      },

      dispose() {
        disposeInstance(instance);
        instances.delete(instance);
      },
    };
  }

  return {
    engine: "quickjs",
    load,
    disposeAll() {
      for (const instance of instances) disposeInstance(instance);
      instances.clear();
    },
  };
}

/* =============================================================================
 * Host functions
 * ========================================================================== */

/**
 * Attach the native side of the bridge.
 *
 * A capability the grant withheld is simply never installed, so the guest shim
 * sees `typeof __nativeFetch !== "function"` and omits `host.fetch` entirely.
 * The absence propagates all the way to the extension author.
 */
function installHostFunctions(instance: Instance, bridge: HostBridge): void {
  const { context } = instance;

  const log = context.newFunction("__nativeLog", (levelHandle, messageHandle) => {
    bridge.log(
      toLogLevel(levelHandle ? context.getString(levelHandle) : "info"),
      messageHandle ? context.getString(messageHandle) : "",
    );
    return context.undefined;
  });
  context.setProp(context.global, "__nativeLog", log);
  log.dispose();

  if (bridge.fetch) {
    const { fetch: brokeredFetch } = bridge;
    attachAsync(instance, "__nativeFetch", async (payload) => {
      const request = JSON.parse(payload) as Parameters<typeof brokeredFetch>[0];
      return JSON.stringify(await brokeredFetch(request));
    });
  }

  if (bridge.readLibrary) {
    const { readLibrary } = bridge;
    attachAsync(instance, "__nativeReadLibrary", async () =>
      JSON.stringify((await readLibrary()) ?? null),
    );
  }

  if (bridge.readProgress) {
    const { readProgress } = bridge;
    attachAsync(instance, "__nativeReadProgress", async () =>
      JSON.stringify((await readProgress()) ?? null),
    );
  }
}

/**
 * Install one host function that takes and returns a JSON string.
 *
 * The native function returns immediately with a guest promise; the host does
 * its work on the Node event loop and settles it afterwards. Rejections carry
 * a message string only — a host stack trace must never be readable from
 * inside the isolate.
 */
function attachAsync(
  instance: Instance,
  name: string,
  implementation: (payload: string) => Promise<string>,
): void {
  const { context, runtime } = instance;

  const handle = context.newFunction(name, (argHandle) => {
    const payload = argHandle === undefined ? "{}" : context.getString(argHandle);
    const promise = context.newPromise();

    implementation(payload).then(
      (result) => {
        if (instance.disposed) return;
        const value = context.newString(result);
        promise.resolve(value);
        value.dispose();
      },
      (error: unknown) => {
        if (instance.disposed) return;
        const message = context.newString(
          error instanceof Error ? error.message : "Host call failed.",
        );
        promise.reject(message);
        message.dispose();
      },
    );

    // Settling queues a microtask inside the guest; nothing runs it but us.
    void promise.settled.then(() => {
      if (!instance.disposed) runtime.executePendingJobs();
    });

    return promise.handle;
  });

  context.setProp(context.global, name, handle);
  handle.dispose();
}

function toLogLevel(value: string): "debug" | "info" | "warn" | "error" {
  return value === "debug" || value === "info" || value === "warn" || value === "error"
    ? value
    : "info";
}

/* =============================================================================
 * Evaluation
 * ========================================================================== */

function evalGuest(instance: Instance, code: string, filename: string, asModule = false): void {
  const { context } = instance;

  instance.deadline = Date.now() + 10_000;
  try {
    const result = context.evalCode(code, filename, asModule ? { type: "module" } : undefined);
    context.unwrapResult(result).dispose();
  } finally {
    instance.deadline = null;
  }
}

async function invoke(
  instance: Instance,
  extensionId: string,
  method: string,
  argsJson: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string> {
  return callBootstrap(
    instance,
    extensionId,
    "invoke",
    [method, argsJson],
    method,
    timeoutMs,
    signal,
  );
}

/**
 * Call one of the functions the bootstrap installed on `__vestra`.
 *
 * Everything crosses as strings: the guest serialises, the host parses. A
 * handle passed either way would give one side a reference into the other's
 * heap, which is the thing the isolate exists to prevent.
 */
async function callBootstrap(
  instance: Instance,
  extensionId: string,
  entry: "invoke" | "methods",
  args: readonly string[],
  /** Named in errors, so a failure points at the guest method, not the plumbing. */
  label: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string> {
  const method = label;
  const { context } = instance;

  // Abort collapses the deadline so the interrupt handler trips on the guest's
  // next tick. There is no way to preempt it from outside.
  const onAbort = () => {
    instance.deadline = 0;
  };
  signal.addEventListener("abort", onAbort, { once: true });
  instance.deadline = signal.aborted ? 0 : Date.now() + timeoutMs;

  const handles: QuickJSHandle[] = [];

  try {
    const vestra = context.getProp(context.global, "__vestra");
    handles.push(vestra);

    const fn = context.getProp(vestra, entry);
    handles.push(fn);

    const argHandles = args.map((value) => {
      const handle = context.newString(value);
      handles.push(handle);
      return handle;
    });

    const called = context.callFunction(fn, vestra, ...argHandles);
    const pending = context.unwrapResult(called);
    handles.push(pending);

    const value = context.unwrapResult(await drain(instance, pending, extensionId, method));
    handles.push(value);

    return context.getString(value);
  } catch (error) {
    if (error instanceof ExtensionExecutionError) throw error;

    const message = error instanceof Error ? error.message : "Extension call failed.";
    throw new ExtensionExecutionError(
      extensionId,
      signal.aborted ? `${method}() was cancelled.` : `${method}() failed: ${message}`,
    );
  } finally {
    signal.removeEventListener("abort", onAbort);
    instance.deadline = null;
    for (const handle of handles.reverse()) {
      if (handle.alive) handle.dispose();
    }
  }
}

/**
 * Drive the guest's job queue until its promise settles.
 *
 * QuickJS has no event loop. Every `await` inside the guest becomes a
 * microtask that only runs when the host calls `executePendingJobs`, so
 * awaiting without pumping deadlocks: the promise waits on a job, the job
 * waits to be run.
 *
 * The wall-clock guard covers what the interrupt handler cannot — a guest
 * promise that never settles is not executing, so no interrupt will ever fire.
 */
async function drain(
  instance: Instance,
  pending: QuickJSHandle,
  extensionId: string,
  method: string,
): Promise<ReturnType<QuickJSContext["resolvePromise"]> extends Promise<infer R> ? R : never> {
  const { context, runtime } = instance;

  const settled = context.resolvePromise(pending);
  let finished = false;
  void settled.then(
    () => (finished = true),
    () => (finished = true),
  );

  while (!finished) {
    if (instance.deadline !== null && Date.now() > instance.deadline) {
      throw new ExtensionExecutionError(
        extensionId,
        `${method}() did not settle before its deadline.`,
      );
    }

    runtime.executePendingJobs();
    // Hand control back to Node so an in-flight host call can resolve.
    await new Promise((resolve) => setImmediate(resolve));
  }

  return settled;
}

function disposeInstance(instance: Instance): void {
  if (instance.disposed) return;
  instance.disposed = true;

  instance.runtime.removeInterruptHandler();
  instance.runtime.removeModuleLoader();

  // A guest that hit its memory ceiling leaves the VM unable to free itself:
  // QuickJS asserts on a non-empty GC list and the abort surfaces here as a
  // host exception. There is nothing to recover — the isolate is gone either
  // way — and the one outcome that must not happen is the host dying because
  // an extension misbehaved. So teardown failures are contained.
  //
  // The cost is a leaked runtime in that case, bounded by how many extensions
  // manage to exhaust their heap, and each one is being unloaded anyway.
  try {
    if (instance.context.alive) instance.context.dispose();
  } catch {
    /* VM already unrecoverable */
  }

  try {
    if (instance.runtime.alive) instance.runtime.dispose();
  } catch {
    /* VM already unrecoverable */
  }
}
