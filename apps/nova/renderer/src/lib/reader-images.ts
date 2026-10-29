/** Shared foreground, preview and look-ahead downloads for one open chapter. */
export class ReaderImages {
  private cache = new Map<string, string>();
  private bytes = 0;
  private jobs = new Map<
    string,
    {
      priority: number;
      started: boolean;
      resolve: (value: string) => void;
      reject: (error: unknown) => void;
      promise: Promise<string>;
    }
  >();
  private active = 0;
  private background = 0;
  private disposed = false;
  constructor(
    private fetch: (handle: string) => Promise<string>,
    private budget = 32 * 1024 * 1024,
  ) {}
  load(handle: string, priority = 0): Promise<string> {
    if (this.disposed) return Promise.reject(new Error("Chapter closed."));
    const cached = this.cache.get(handle);
    if (cached !== undefined) {
      this.cache.delete(handle);
      this.cache.set(handle, cached);
      return Promise.resolve(cached);
    }
    const existing = this.jobs.get(handle);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      this.pump();
      return existing.promise;
    }
    let resolve!: (value: string) => void, reject!: (error: unknown) => void;
    const promise = new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.jobs.set(handle, {
      priority,
      started: false,
      resolve,
      reject,
      promise,
    });
    this.pump();
    return promise;
  }
  preview(handle: string) {
    for (const [key, job] of this.jobs) {
      if (key !== handle && !job.started && job.priority === 1) {
        this.jobs.delete(key);
        job.reject(new Error("Preview position changed."));
      }
    }
    return this.load(handle, 1);
  }
  prefetch(handles: string[]) {
    const keep = new Set(handles);
    for (const [key, job] of this.jobs) {
      if (!job.started && job.priority >= 10 && !keep.has(key)) {
        this.jobs.delete(key);
        job.reject(new Error("Look-ahead position changed."));
      }
    }
    for (const handle of handles)
      void this.load(handle, 10).catch(() => undefined);
  }
  private pump() {
    while (!this.disposed && this.active < 4) {
      const entry = [...this.jobs]
        .filter(
          ([, job]) =>
            !job.started && (job.priority < 10 || this.background < 3),
        )
        .sort((a, b) => a[1].priority - b[1].priority)[0];
      if (!entry) return;
      const [handle, job] = entry;
      job.started = true;
      this.active++;
      const background = job.priority >= 10;
      if (background) this.background++;
      void Promise.resolve()
        .then(() => this.fetch(handle))
        .then(
          (value) => {
            if (!this.disposed && value.length * 2 <= this.budget) {
              this.cache.set(handle, value);
              this.bytes += value.length * 2;
              while (this.bytes > this.budget || this.cache.size > 32) {
                const oldest = this.cache.keys().next().value!;
                this.bytes -= this.cache.get(oldest)!.length * 2;
                this.cache.delete(oldest);
              }
            }
            this.jobs.delete(handle);
            job.resolve(value);
          },
          (error) => {
            this.jobs.delete(handle);
            job.reject(error);
          },
        )
        .finally(() => {
          this.active--;
          if (background) this.background--;
          this.pump();
        });
    }
  }
  dispose() {
    this.disposed = true;
    this.cache.clear();
    this.bytes = 0;
    for (const [key, job] of this.jobs)
      if (!job.started) {
        this.jobs.delete(key);
        job.reject(new Error("Chapter closed."));
      }
  }
}

export function hoverPage(
  clientX: number,
  left: number,
  width: number,
  count: number,
) {
  const ratio = Math.max(
    0,
    Math.min(1, (clientX - left - 8) / Math.max(1, width - 16)),
  );
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
}
