interface Pending<T> {
  controller: AbortController;
  promise: Promise<T>;
  users: number;
}

/** Shared metadata requests; cancelling one caller never cancels another caller's work. */
export class AbortableCache<T> {
  private values = new Map<string, { value: T; expires: number }>();
  private pending = new Map<string, Pending<T>>();
  constructor(
    private ttlMs: number,
    private maxEntries = 20,
  ) {}

  run(
    key: string,
    load: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
    keep: (value: T) => boolean = () => true,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const hit = this.values.get(key);
    if (hit && hit.expires > Date.now())
      return Promise.resolve(structuredClone(hit.value));
    if (hit) this.values.delete(key);
    let pending = this.pending.get(key);
    if (!pending) {
      const controller = new AbortController();
      const entry: Pending<T> = {
        controller,
        users: 0,
        promise: Promise.resolve().then(() => load(controller.signal)),
      };
      entry.promise = entry.promise
        .then((value) => {
          controller.signal.throwIfAborted();
          if (keep(value)) {
            if (this.values.size >= this.maxEntries)
              this.values.delete(this.values.keys().next().value!);
            this.values.set(key, {
              value: structuredClone(value),
              expires: Date.now() + this.ttlMs,
            });
          }
          return value;
        })
        .finally(() => {
          if (this.pending.get(key) === entry) this.pending.delete(key);
        });
      pending = entry;
      this.pending.set(key, entry);
    }
    const entry = pending;
    entry.users++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        signal?.removeEventListener("abort", abort);
        entry.users--;
        return true;
      };
      const abort = () => {
        if (!finish()) return;
        reject(signal!.reason);
        if (!entry.users) {
          if (this.pending.get(key) === entry) this.pending.delete(key);
          entry.controller.abort();
        }
      };
      signal?.addEventListener("abort", abort, { once: true });
      entry.promise.then(
        (value) => {
          if (finish()) resolve(structuredClone(value));
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
    });
  }
}
