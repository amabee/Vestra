import { mediaRefSchema } from "@vestra/types";
import { ipcMain } from "electron";
import { z } from "zod";
import { AnimeService } from "./anime-service";
import { getStreamSourceRegistry, getProviderRegistry } from "./services";
export function registerAnimeIpc() {
  const service = new AnimeService(getStreamSourceRegistry());
  ipcMain.handle("anime:sources", () => service.list());
  ipcMain.handle("anime:search", (_e, id, query) =>
    service.search(
      z.string().min(1).max(120).parse(id),
      z.string().trim().min(1).max(500).parse(query),
    ),
  );
  ipcMain.handle("anime:resolve", async (_e, id, rawRef) => {
    const ref = mediaRefSchema.parse(rawRef);
    if (ref.kind !== "anime") throw new Error("Choose an anime title.");
    const item = await getProviderRegistry()
      .forRef(ref)
      ?.getDetails?.(ref, {
        signal: AbortSignal.timeout(15000),
        timeoutMs: 15000,
      });
    if (!item)
      throw new Error(
        "Anime information is unavailable. Retry the title lookup.",
      );
    return service.resolve(z.string().min(1).max(120).parse(id), item);
  });
  ipcMain.handle("anime:episodes", (_e, handle) =>
    service.episodes(z.string().uuid().parse(handle)),
  );
}
