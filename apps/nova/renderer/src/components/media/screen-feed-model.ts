import { mediaKey, type MediaItem } from "@vestra/types";
import type { ScreenPage, ScreenSource } from "../../../../shared/screen";

export interface FeedBatch {
  items: MediaItem[];
  hasMore: boolean;
  warnings: string[];
  capped: boolean;
}
let session = 0;
/** Pull only enough data for one visible batch; keep fixed upstream page sizes stable. */
export class ScreenFeedModel {
  readonly session = ++session;
  private sources;
  private next = 0;
  private pending: MediaItem[] = [];
  private seen = new Set<string>();
  private batches = new Map<number, FeedBatch>();
  private active: Promise<FeedBatch> | undefined;
  constructor(
    providers: ScreenSource[],
    private fetchPage: (source: string, page: number) => Promise<ScreenPage>,
  ) {
    this.sources = providers.map((provider) => ({
      ...provider,
      page: 1,
      done: false,
      error: "",
    }));
  }
  snapshot() {
    if (!this.batches.has(0)) return undefined;
    const pages: FeedBatch[] = [];
    for (let index = 0; this.batches.has(index); index++)
      pages.push(this.batches.get(index)!);
    return { pages, pageParams: pages.map((_, index) => index) };
  }
  retryFailed() {
    for (const source of this.sources) source.error = "";
  }
  read(index: number): Promise<FeedBatch> {
    const cached = this.batches.get(index);
    if (cached) return Promise.resolve(cached);
    if (this.active) return this.active;
    this.active = this.pull(index).finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
  private async pull(index: number): Promise<FeedBatch> {
    const count = index === 0 ? 14 : 7;
    const items: MediaItem[] = [];
    let requests = 0;
    let stopAfterPending = false;
    while (items.length < count) {
      if (this.pending.length) {
        items.push(...this.pending.splice(0, count - items.length));
        if (stopAfterPending) break;
        continue;
      }
      let source;
      for (let step = 0; step < this.sources.length; step++) {
        const candidate = this.sources[this.next % this.sources.length]!;
        if (!candidate.done && !candidate.error && candidate.page <= 100) {
          source = candidate;
          break;
        }
        this.next++;
      }
      if (!source || requests >= 4) break;
      requests++;
      try {
        const result = await this.fetchPage(source.id, source.page);
        source.page++;
        source.done = !result.hasMore;
        for (const item of result.items) {
          const identity = item.year
            ? `${item.kind}:${item.title
                .normalize("NFKC")
                .toLowerCase()
                .replace(/[^\p{L}\p{N}]+/gu, " ")
                .trim()}:${item.year}`
            : mediaKey(item);
          if (this.seen.has(identity)) continue;
          this.seen.add(identity);
          this.pending.push(item);
        }
        if (source.done || this.pending.length >= count - items.length)
          this.next++;
        // Show a finished provider's short result immediately; do not wait for
        // another provider merely to fill the last few spaces.
        if (source.done && this.pending.length) stopAfterPending = true;
      } catch (error) {
        source.error = `${source.name}: ${error instanceof Error ? error.message : "Could not load titles"}`;
        this.next++;
      }
    }
    const warnings = this.sources.flatMap((source) =>
      source.error ? [source.error] : [],
    );
    if (!items.length && warnings.length) throw Error(warnings.join("; "));
    const batch = {
      items,
      warnings,
      hasMore:
        this.pending.length > 0 ||
        this.sources.some((source) => !source.done && source.page <= 100),
      capped: this.sources.some((source) => !source.done && source.page > 100),
    };
    this.batches.set(index, batch);
    return batch;
  }
}

/** Bounded session cache: reuse feed cursors and buffered pages across navigation. */
export class ScreenFeedSessions {
  private entries = new Map<string, ScreenFeedModel>();
  constructor(private capacity = 12) {}
  get(key: string, create: () => ScreenFeedModel, refresh = false) {
    const model = (!refresh && this.entries.get(key)) || create();
    this.entries.delete(key);
    this.entries.set(key, model);
    while (this.entries.size > this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
    return model;
  }
}
