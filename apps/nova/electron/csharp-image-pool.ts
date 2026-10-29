import { CSharpProviderWorker } from "./csharp-worker";

type Worker = Pick<CSharpProviderWorker, "request" | "stop" | "isFailed">;
/** Image-only sidecars keep guarded downloads parallel and off the JS/store lane. */
export class CSharpImagePool {
  private lanes: {
    worker: Worker | null;
    queued: number;
    idle?: ReturnType<typeof setTimeout>;
  }[];
  private stopped = false;
  constructor(
    private create: () => Worker,
    concurrency = 4,
  ) {
    this.lanes = Array.from({ length: concurrency }, () => ({
      worker: null,
      queued: 0,
    }));
  }
  async image(request: unknown): Promise<unknown> {
    if (this.stopped) throw new Error("Image runtime is shutting down.");
    const lane = this.lanes.reduce((best, next) =>
      next.queued < best.queued ? next : best,
    );
    if (lane.queued >= 8)
      throw new Error("Too many image downloads. Retry shortly.");
    clearTimeout(lane.idle);
    lane.queued++;
    try {
      if (!lane.worker || lane.worker.isFailed) lane.worker = this.create();
      return await lane.worker.request({ kind: "image", request });
    } finally {
      lane.queued--;
      if (!this.stopped && lane.queued === 0) {
        lane.idle = setTimeout(() => {
          lane.worker?.stop();
          lane.worker = null;
        }, 60_000);
        lane.idle.unref();
      }
    }
  }
  stop() {
    this.stopped = true;
    for (const lane of this.lanes) {
      clearTimeout(lane.idle);
      lane.worker?.stop();
    }
  }
}

export const createImagePool = (target: string) =>
  new CSharpImagePool(() => new CSharpProviderWorker(target));
