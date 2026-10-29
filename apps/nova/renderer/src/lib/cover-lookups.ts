/** At most two metadata lookups may occupy the provider lane at once. */
export class CoverLookups {
  private active = 0;
  private closed = false;
  private queue: { start: () => void; cancel: () => void }[] = [];
  run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (this.closed || signal.aborted)
      return Promise.reject(
        new DOMException("Cover lookup cancelled", "AbortError"),
      );
    return new Promise<T>((resolve, reject) => {
      const cancel = () => {
        const index = this.queue.indexOf(job);
        if (index < 0) return;
        this.queue.splice(index, 1);
        signal.removeEventListener("abort", cancel);
        reject(new DOMException("Cover lookup cancelled", "AbortError"));
      };
      const job = {
        cancel,
        start: () => {
          signal.removeEventListener("abort", cancel);
          this.active++;
          void Promise.resolve()
            .then(work)
            .then(resolve, reject)
            .finally(() => {
              this.active--;
              this.pump();
            });
        },
      };
      signal.addEventListener("abort", cancel, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }
  private pump() {
    while (!this.closed && this.active < 2 && this.queue.length)
      this.queue.shift()!.start();
  }
  dispose() {
    this.closed = true;
    for (const job of [...this.queue]) job.cancel();
  }
}
