import { randomUUID } from "node:crypto";
import { z } from "zod";
import { mediaKey } from "@vestra/types";
import {
  readDocument,
  writeDocument,
  type StorageDriver,
} from "@vestra/storage";
import {
  animePlaylistSchema,
  playlistCommandSchema,
  type AnimePlaylist,
} from "../shared/playlists";

const schema = z.object({
  version: z.literal(1),
  playlists: z.array(animePlaylistSchema).max(100),
});
const KEY = "anime-playlists-v1";

/** Serializes read-modify-write commands so rapid adds cannot overwrite each other. */
export class AnimePlaylists {
  private lane: Promise<unknown> = Promise.resolve();
  constructor(private driver: () => StorageDriver) {}
  async list(): Promise<AnimePlaylist[]> {
    await this.lane;
    return (
      await readDocument(this.driver(), KEY, schema, {
        version: 1,
        playlists: [],
      })
    ).playlists;
  }
  mutate(raw: unknown): Promise<AnimePlaylist[]> {
    const command = playlistCommandSchema.parse(raw);
    const task = this.lane.then(async () => {
      const document = await readDocument(this.driver(), KEY, schema, {
        version: 1,
        playlists: [],
      });
      const rows = document.playlists;
      if (command.action === "create") {
        if (rows.length >= 100)
          throw Error("You can create up to 100 playlists.");
        rows.push({
          id: randomUUID(),
          name: command.name,
          updatedAt: Date.now(),
          items: [],
        });
      } else {
        const list = rows.find((row) => row.id === command.id);
        if (!list) throw Error("This playlist no longer exists.");
        if (command.action === "delete") rows.splice(rows.indexOf(list), 1);
        else if (command.action === "rename") list.name = command.name;
        else if (command.action === "add") {
          const existing = list.items.findIndex(
            (row) => mediaKey(row.item) === mediaKey(command.entry.item),
          );
          if (existing >= 0) list.items[existing] = command.entry;
          else {
            if (list.items.length >= 500) throw Error("This playlist is full.");
            list.items.push(command.entry);
          }
        } else {
          const index = list.items.findIndex(
            (row) => mediaKey(row.item) === command.key,
          );
          if (index < 0)
            throw Error("This anime is no longer in the playlist.");
          const [entry] = list.items.splice(index, 1);
          if (command.action === "move")
            list.items.splice(
              Math.min(command.to, list.items.length),
              0,
              entry!,
            );
        }
        list.updatedAt = Date.now();
      }
      await writeDocument(this.driver(), KEY, schema, document);
      return rows;
    });
    this.lane = task.catch(() => undefined);
    return task;
  }
}
