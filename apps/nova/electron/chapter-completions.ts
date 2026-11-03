import { createHash } from "node:crypto";
import { z } from "zod";
import type { StorageDriver } from "@vestra/storage";
import type { ChapterCount } from "../shared/media-counts";
const snapshotSchema = z.object({
  version: z.literal(1),
  chapters: z.array(z.string().min(1).max(4096)).max(10000),
  completed: z.array(z.string().min(1).max(4096)).max(10000),
  historyKnown: z.boolean(),
  updatedAt: z.number(),
});
/** Completion metadata complements the existing resume position; it never replaces it. */
export class ChapterCompletions {
  private queues = new Map<string, Promise<unknown>>();
  constructor(private driver: StorageDriver) {}
  private key(p: string, b: string) {
    return (
      "manga-chapters-" +
      createHash("sha256")
        .update(JSON.stringify([p, b]))
        .digest("hex")
        .slice(0, 40)
    );
  }
  private async read(key: string) {
    const raw = await this.driver.read(key);
    return raw === null ? null : snapshotSchema.parse(raw);
  }
  private mutate(
    p: string,
    b: string,
    change: (
      state: z.infer<typeof snapshotSchema> | null,
    ) => z.infer<typeof snapshotSchema> | null,
  ) {
    const key = this.key(p, b);
    const result = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const next = change(await this.read(key));
        if (next) await this.driver.write(key, snapshotSchema.parse(next));
      });
    this.queues.set(key, result);
    void result
      .finally(() => {
        if (this.queues.get(key) === result) this.queues.delete(key);
      })
      .catch(() => undefined);
    return result;
  }
  inventory(
    p: string,
    b: string,
    chapters: string[],
    hasLegacyProgress: boolean,
  ) {
    return this.mutate(p, b, (state) => ({
      version: 1,
      chapters: [...new Set(chapters)],
      completed: state?.completed ?? [],
      historyKnown: state?.historyKnown ?? !hasLegacyProgress,
      updatedAt: Date.now(),
    }));
  }
  complete(p: string, b: string, chapter: string) {
    return this.mutate(p, b, (state) =>
      state && state.chapters.includes(chapter)
        ? {
            ...state,
            completed: [...new Set([...state.completed, chapter])],
            updatedAt: Date.now(),
          }
        : state,
    );
  }
  markAll(p: string, b: string, read: boolean) {
    return this.mutate(p, b, (state) => {
      if (!state) throw new Error("Load this manga's chapters first.");
      return {
        ...state,
        completed: read ? [...state.chapters] : [],
        historyKnown: true,
        updatedAt: Date.now(),
      };
    });
  }
  async count(p: string, b: string): Promise<ChapterCount | null> {
    const key = this.key(p, b);
    await this.queues.get(key);
    const state = await this.read(key);
    if (!state) return null;
    const done = new Set(state.completed);
    const completed = state.chapters.filter((id) => done.has(id)).length;
    return {
      total: state.chapters.length,
      completed,
      unread: state.historyKnown ? state.chapters.length - completed : null,
      historyKnown: state.historyKnown,
      updatedAt: state.updatedAt,
    };
  }
}
