/** Distinguish repeated real stalls from seeking, pauses and stale cache flags. */
export class RebufferTracker {
  private samples: { ended: number; duration: number }[] = [];
  private active: { started: number; position: number } | null = null;
  reset() {
    this.samples = [];
    this.active = null;
  }
  begin(now: number, position: number) {
    this.active ??= { started: now, position };
  }
  end(now: number, position: number) {
    if (!this.active) return;
    const duration = now - this.active.started;
    if (duration >= 250 && Math.abs(position - this.active.position) < 0.5)
      this.samples.push({ ended: now, duration });
    this.active = null;
  }
  remaining(now: number) {
    this.samples = this.samples.filter(
      (sample) => sample.ended >= now - 60_000,
    );
    if (!this.active || this.samples.length < 2) return Infinity;
    return Math.max(
      0,
      6000 -
        this.samples.reduce(
          (sum, sample) =>
            sum + Math.min(sample.duration, sample.ended - now + 60_000),
          0,
        ) -
        (now - this.active.started),
    );
  }
  elapsed(now: number) {
    return this.active ? now - this.active.started : 0;
  }
}
