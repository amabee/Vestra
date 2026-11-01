import { randomUUID } from "node:crypto";
import { AbortableCache } from "./abortable-cache";

export interface ProviderEpisode {
  id: string;
  number: number;
  title?: string;
  url: string;
  provider: string;
}

/** Cache raw provider metadata, never signed streams; keep opaque handles outside the cache. */
export class CSharpAnimeEpisodes {
  private cache = new AbortableCache<ProviderEpisode[]>(5 * 60_000, 8);
  private episodes = new Map<string, ProviderEpisode>();
  private handles = new Map<string, string>();
  constructor(
    private load: (
      animeId: string,
      signal: AbortSignal,
    ) => Promise<ProviderEpisode[]>,
  ) {}

  async list(animeId: string, signal?: AbortSignal) {
    const rows = await this.cache.run(
      animeId,
      async (sharedSignal) =>
        (await this.load(animeId, sharedSignal)).slice(0, 2000),
      signal,
      (rows) => rows.length > 0,
    );
    signal?.throwIfAborted();
    return rows.map((row) => {
      const identity = JSON.stringify([animeId, row]);
      let handle = this.handles.get(identity);
      if (!handle) {
        if (this.handles.size >= 5000) {
          const oldest = this.handles.keys().next().value!;
          this.episodes.delete(this.handles.get(oldest)!);
          this.handles.delete(oldest);
        }
        handle = randomUUID();
        this.handles.set(identity, handle);
        this.episodes.set(handle, structuredClone(row));
      }
      return { ...row, id: handle, animeId };
    });
  }

  get(handle: string) {
    return this.episodes.get(handle);
  }
}
