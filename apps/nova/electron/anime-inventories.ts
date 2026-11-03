import { z } from "zod";
import { mediaKey } from "@vestra/types";
import type { StorageDriver } from "@vestra/storage";
import type { AnimeSourceEpisodes } from "../shared/anime";
const inventorySchema = z.record(
  z.string(),
  z.object({
    episodes: z
      .array(
        z.object({
          id: z.string().max(4096),
          number: z.number().nullable(),
          season: z.number().nullable(),
        }),
      )
      .max(2000),
    updatedAt: z.number(),
    complete: z.boolean(),
  }),
);
const KEY = "anime-episode-inventories-v1";
export class AnimeInventories {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private driver: StorageDriver) {}
  async list() {
    await this.queue;
    const parsed = inventorySchema.safeParse(await this.driver.read(KEY));
    return parsed.success ? parsed.data : {};
  }
  remember(result: AnimeSourceEpisodes) {
    const work = this.queue.then(async () => {
      const parsed = inventorySchema.safeParse(await this.driver.read(KEY));
      const rows = parsed.success ? parsed.data : {};
      rows[
        `${mediaKey(result.item)}:${result.provider ?? result.item.source}`
      ] = {
        updatedAt: Date.now(),
        complete: result.episodesComplete !== false,
        episodes: result.queue.flatMap((ep) => {
          const id = ep.progressId ?? ep.fileId;
          return id
            ? [{ id, number: ep.episode ?? null, season: ep.season ?? null }]
            : [];
        }),
      };
      // Missing identities cannot produce an exact count.
      if (
        rows[
          `${mediaKey(result.item)}:${result.provider ?? result.item.source}`
        ]!.episodes.length !== result.queue.length
      )
        rows[
          `${mediaKey(result.item)}:${result.provider ?? result.item.source}`
        ]!.complete = false;
      const bounded = Object.fromEntries(
        Object.entries(rows)
          .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
          .slice(0, 256),
      );
      await this.driver.write(KEY, inventorySchema.parse(bounded));
    });
    this.queue = work.catch(() => undefined);
    return work;
  }
}

const instances = new WeakMap<StorageDriver, AnimeInventories>();
export function getAnimeInventories(driver: StorageDriver) {
  let value = instances.get(driver);
  if (!value) {
    value = new AnimeInventories(driver);
    instances.set(driver, value);
  }
  return value;
}
