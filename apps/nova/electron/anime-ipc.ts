import { getAnimeInventories } from "./anime-inventories";
import type { AnimeSourceEpisodes } from "../shared/anime";
import { getWatchlist, getHistory, getAllProgress } from "@vestra/storage";
import { mediaRefSchema, mediaItemSchema } from "@vestra/types";
import { ipcMain } from "electron";
import { z } from "zod";
import { resolveCataloguePlayback } from "./catalogue-playback";
import { getAdapterRegistry } from "./services";
import { AnimePlaylists } from "./anime-playlists";
import { getDriver } from "./services";
import { AnimeService } from "./anime-service";
import { AnimeDiscovery } from "./anime-discovery";
import { AnimeSchedule } from "./anime-schedule";
import { AnimeExplore } from "./anime-explore";
import { getStreamSourceRegistry, getProviderRegistry } from "./services";
export function registerAnimeIpc() {
  const inventories = getAnimeInventories(getDriver());
  const remember = async (
    work: AnimeSourceEpisodes | null | Promise<AnimeSourceEpisodes | null>,
  ) => {
    const value = await work;
    if (value) await inventories.remember(value).catch(() => undefined);
    return value;
  };
  ipcMain.handle("anime:inventories", () => inventories.list());
  const explore = new AnimeExplore();
  ipcMain.handle("anime:snapshots", (_e, ids) => explore.snapshots(ids));
  ipcMain.handle("anime:explore", (_e, query) => explore.load(query));
  const service = new AnimeService(getStreamSourceRegistry());
  const discovery = new AnimeDiscovery(getStreamSourceRegistry(), service);
  ipcMain.handle("anime:browse", (_e, id, query) =>
    discovery.browse(z.string().min(1).max(120).parse(id), query),
  );
  const playlists = new AnimePlaylists(getDriver);
  const schedule = new AnimeSchedule(async () => {
    const [watchlist, history, progress, lists] = await Promise.all([
      getWatchlist(getDriver()),
      getHistory(getDriver()),
      getAllProgress(getDriver()),
      playlists.list(),
    ]);
    return { watchlist, history, progress, playlists: lists };
  });
  ipcMain.handle("anime:schedule", (_e, query) => schedule.load(query));
  ipcMain.handle("anime:playlists", () => playlists.list());
  ipcMain.handle("anime:playlist-command", (_e, command) =>
    playlists.mutate(command),
  );
  ipcMain.handle("anime:open", async (_e, rawId, rawItem) => {
    const id = z.string().min(1).max(120).parse(rawId);
    const item = mediaItemSchema.parse(rawItem);
    if (item.kind !== "anime") throw Error("Choose an anime title.");
    if (id === "local") {
      const queue = (
        await resolveCataloguePlayback(
          getProviderRegistry(),
          getAdapterRegistry(),
          getStreamSourceRegistry(),
          item,
          "builtin",
        )
      ).filter((entry) => entry.kind === "file");
      return remember({ item, queue, provider: "local" });
    }
    if (item.source === id) return remember(service.open(item));
    if (item.source.startsWith("ext-"))
      return remember(service.resolve(id, item));
    const details = await getProviderRegistry()
      .forRef(item)
      ?.getDetails?.(item, {
        signal: AbortSignal.timeout(15000),
        timeoutMs: 15000,
      });
    if (!details)
      throw Error("Anime information could not be loaded. Try again.");
    return remember(service.resolve(id, details));
  });
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
    if (
      ref.source.startsWith("ext-") ||
      getStreamSourceRegistry().get(ref.source)
    ) {
      const saved =
        (await playlists.list())
          .flatMap((list) => list.items)
          .find(
            (row) =>
              row.item.source === ref.source &&
              row.item.sourceId === ref.sourceId,
          )?.item ??
        (await getWatchlist(getDriver())).find(
          (row) =>
            row.ref.source === ref.source && row.ref.sourceId === ref.sourceId,
        )?.snapshot ??
        (await getHistory(getDriver())).find(
          (row) =>
            row.ref.source === ref.source && row.ref.sourceId === ref.sourceId,
        )?.snapshot ??
        service.rememberedItem(ref);
      if (!saved)
        throw Error(
          "This source title is no longer known. Search it again in Anime.",
        );
      const selected = z.string().min(1).max(120).parse(id);
      return remember(
        selected === saved.source
          ? service.open(saved)
          : service.resolve(selected, saved),
      );
    }

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
    return remember(
      service.resolve(z.string().min(1).max(120).parse(id), item),
    );
  });
  ipcMain.handle("anime:title", (_e, handle) =>
    service.title(z.string().uuid().parse(handle)),
  );
  ipcMain.handle("anime:episodes", (_e, handle) =>
    remember(service.episodes(z.string().uuid().parse(handle))),
  );
}
