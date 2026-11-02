import type { CSharpProviderSession } from "./csharp-worker";

type Session = Pick<CSharpProviderSession, "request" | "stop">;
type Definition = Record<string, unknown> & { id: string };
interface Entry {
  definition: Definition;
  session?: Session;
  busy: boolean;
  used: number;
  idle?: ReturnType<typeof setTimeout>;
}
interface Job {
  entry: Entry;
  signal?: AbortSignal;
  run: (session: Session, loaded: unknown) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  cleanup: () => void;
}

/** One guest runtime per active anime provider; bounded, idle workers are reusable slots. */
export class CSharpAnimePool {
  private entries = new Map<string, Entry>();
  private queue: Job[] = [];
  private stopped = false;
  private pumping = false;
  constructor(
    private create: () => Session,
    private capacity = 4,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error("Invalid anime worker capacity.");
  }

  has(id: string) {
    return this.entries.has(id);
  }

  async load(definition: Definition): Promise<unknown> {
    if (this.stopped) throw new Error("Anime runtime is shutting down.");
    if (this.has(definition.id))
      throw new Error("Anime provider is already loaded.");
    const entry: Entry = {
      definition: structuredClone(definition),
      busy: false,
      used: 0,
    };
    this.entries.set(definition.id, entry);
    try {
      return await this.enqueue(entry, async (_session, loaded) => loaded);
    } catch (error) {
      if (this.entries.get(definition.id) === entry) this.remove(definition.id);
      throw error;
    }
  }

  call(
    id: string,
    method: string,
    args: unknown[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const entry = this.entries.get(id);
    if (!entry)
      return Promise.reject(
        new Error("Anime provider is disabled or unavailable."),
      );
    const command = structuredClone({
      kind: "call",
      providerId: id,
      method,
      args,
    });
    return this.enqueue(
      entry,
      (session) => session.request(command, signal),
      signal,
    );
  }

  private enqueue(
    entry: Entry,
    run: Job["run"],
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.stopped)
      return Promise.reject(new Error("Anime runtime is shutting down."));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.queue.length >= 64)
      return Promise.reject(
        new Error("Too many anime requests. Retry shortly."),
      );
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.queue = this.queue.filter((row) => row !== job);
        job.cleanup();
        reject(signal!.reason);
        this.pump();
      };
      const job: Job = {
        entry,
        run,
        signal,
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener("abort", abort),
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }

  private release(
    entry: Entry,
    reason: "idle" | "evicted" | "load-failed" | "disabled" | "shutdown",
  ) {
    clearTimeout(entry.idle);
    if (entry.busy && entry.session)
      console.info(`[nova] anime worker released during a request: ${reason}`);
    entry.session?.stop(new Error(`C# provider worker stopped (${reason}).`));
    entry.session = undefined;
  }

  private pump() {
    if (this.stopped || this.pumping) return;
    this.pumping = true;
    try {
      for (const job of [...this.queue]) {
        const entry = job.entry;
        if (entry.busy) continue;
        if (!entry.session) {
          const residents = [...this.entries.values()].filter(
            (row) => row.session,
          );
          if (residents.length >= this.capacity) {
            const idle = residents
              .filter((row) => !row.busy)
              .sort((a, b) => a.used - b.used)[0];
            if (!idle) continue;
            this.release(idle, "evicted");
          }
        }
        this.queue.splice(this.queue.indexOf(job), 1);
        job.cleanup();
        clearTimeout(entry.idle);
        entry.busy = true;
        void this.execute(job);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async execute(job: Job) {
    const entry = job.entry;
    try {
      job.signal?.throwIfAborted();
      let loaded: unknown;
      if (!entry.session) {
        entry.session = this.create();
        try {
          loaded = await entry.session.request(
            { kind: "load", provider: entry.definition },
            job.signal,
          );
        } catch (error) {
          this.release(entry, "load-failed");
          throw error;
        }
      }
      // Disabling a provider during startup must not dispatch the queued call.
      if (this.entries.get(entry.definition.id) !== entry)
        throw new Error("Anime provider was disabled.");
      const result = await job.run(entry.session, loaded);
      if (this.entries.get(entry.definition.id) !== entry)
        throw new Error("Anime provider was disabled.");
      job.resolve(result);
    } catch (error) {
      job.reject(error);
    } finally {
      entry.busy = false;
      entry.used = Date.now();
      if (!this.stopped && this.entries.get(entry.definition.id) === entry) {
        const session = entry.session;
        entry.idle = setTimeout(() => {
          // A timer queued before another request started must not stop its worker.
          if (
            !entry.busy &&
            entry.session === session &&
            this.entries.get(entry.definition.id) === entry
          )
            this.release(entry, "idle");
        }, 60_000);
        entry.idle.unref();
      }
      this.pump();
    }
  }

  remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    this.release(entry, this.stopped ? "shutdown" : "disabled");
    for (const job of this.queue.filter((row) => row.entry === entry)) {
      job.cleanup();
      job.reject(new Error("Anime provider was disabled."));
    }
    this.queue = this.queue.filter((row) => row.entry !== entry);
    this.pump();
  }

  stop() {
    this.stopped = true;
    for (const id of this.entries.keys()) this.remove(id);
  }
}
