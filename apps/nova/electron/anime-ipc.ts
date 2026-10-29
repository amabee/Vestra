import { ipcMain } from "electron";
import { z } from "zod";
import { AnimeService } from "./anime-service";
import { getStreamSourceRegistry } from "./services";
export function registerAnimeIpc() {
  const service = new AnimeService(getStreamSourceRegistry());
  ipcMain.handle("anime:sources", () => service.list());
  ipcMain.handle("anime:search", (_e, id, query) =>
    service.search(
      z.string().min(1).max(120).parse(id),
      z.string().trim().min(1).max(500).parse(query),
    ),
  );
  ipcMain.handle("anime:episodes", (_e, handle) =>
    service.episodes(z.string().uuid().parse(handle)),
  );
}
