import type { MpvState } from "./session";

const telemetry = new Set([
  "position",
  "bufferedSeconds",
  "downloadBytesPerSecond",
]);

/** Limit progress/cache IPC to 10 Hz; readiness, errors and user controls stay immediate. */
export class MpvStatePublisher {
  private published: MpvState | null = null;
  private latest: MpvState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = 0;
  constructor(private publish: (state: MpvState) => void) {}

  push(state: MpvState) {
    this.latest = state;
    const changed = this.published
      ? (Object.keys(state) as (keyof MpvState)[]).filter(
          (key) => state[key] !== this.published![key],
        )
      : null;
    if (changed?.length === 0) return;
    if (
      !changed ||
      changed.some((key) => !telemetry.has(key)) ||
      Date.now() - this.lastSent >= 100
    ) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(
        () => this.flush(),
        Math.max(0, 100 - (Date.now() - this.lastSent)),
      );
    }
  }
  private flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.latest) return;
    this.published = this.latest;
    this.lastSent = Date.now();
    this.publish(this.latest);
  }
  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.latest = null;
  }
}
