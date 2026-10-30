/**
 * A small in-memory cache with an expiry time.
 * Calls with the same key that arrive while one is still running share that
 * one request. Failed requests are never cached, so a retry always goes out.
 */
export class TtlCache<T> {
  private values = new Map<string, { value: T; expires: number }>();
  private pending = new Map<string, Promise<T>>();

  constructor(
    private ttlMs: number,
    private maxEntries = 100,
  ) {}

  /** Returns a fresh cached value, or runs `load` once and keeps the result. */
  run(
    key: string,
    load: () => Promise<T>,
    keep: (value: T) => boolean = () => true,
  ): Promise<T> {
    const hit = this.values.get(key);
    if (hit && hit.expires > Date.now()) return Promise.resolve(hit.value);
    if (hit) this.values.delete(key);
    const running = this.pending.get(key);
    if (running) return running;
    const request = load()
      .then((value) => {
        if (keep(value)) this.store(key, value);
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  private store(key: string, value: T) {
    if (this.values.size >= this.maxEntries)
      this.values.delete(this.values.keys().next().value!);
    this.values.set(key, { value, expires: Date.now() + this.ttlMs });
  }
}
