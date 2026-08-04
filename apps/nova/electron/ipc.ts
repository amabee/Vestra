import {
  addHistoryEntry,
  addToWatchlist,
  clearHistory,
  clearProgress,
  getAllProgress,
  getHistory,
  getLocalFiles,
  getSettings,
  getWatchlist,
  removeFromWatchlist,
  saveProgress,
  saveSettings,
} from "@vestra/storage";
import { resolvePlayback, searchAcrossProviders, trendingAcrossProviders } from "@vestra/provider-sdk";
import {
  mediaItemSchema,
  mediaKindSchema,
  mediaRefSchema,
  searchQuerySchema,
  settingsSchema,
  watchlistStatusSchema,
} from "@vestra/types";
import { ipcMain } from "electron";
import { z } from "zod";

import {
  callExtension,
  listLoadedExtensions,
} from "./extensions";
import { getAdapterRegistry, getDriver, getProviderRegistry, resolveDataDir } from "./services";

/**
 * IPC surface.
 *
 * These channels replace the fourteen HTTP route handlers the deleted app
 * exposed. The logic is unchanged — it always lived in `packages/*`; only the
 * transport moved from fetch to `ipcRenderer.invoke`.
 *
 * Every payload is validated even though the renderer is our own code. The
 * renderer is the part that loads remote images, will eventually render
 * extension output, and is the only process an attacker can realistically
 * reach. Treating its messages as untrusted is the whole reason context
 * isolation is switched on.
 */

/** Wraps a handler so a thrown error reaches the renderer as a message, not a stack. */
function handle<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => Promise<TResult> | TResult,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return await handler(...(args as TArgs));
    } catch (error) {
      // Log the real error here; hand the renderer something safe to display.
      console.error(`[nova] ${channel} failed`, error);
      throw new Error(error instanceof Error ? error.message : `${channel} failed.`);
    }
  });
}

/** Parses an IPC argument, refusing rather than coercing. */
function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${what}: ${result.error.issues[0]?.message ?? "bad payload"}`);
  }
  return result.data;
}

const progressInputSchema = z.object({
  ref: mediaRefSchema,
  episodeId: z.string().max(200).nullable().default(null),
  positionSeconds: z.number().min(0),
  durationSeconds: z.number().min(0),
});

const watchlistAddSchema = z.object({
  item: mediaItemSchema,
  status: watchlistStatusSchema.optional(),
});

const historyAddSchema = z.object({
  item: mediaItemSchema,
  episodeId: z.string().max(200).nullable().optional(),
  positionSeconds: z.number().min(0).optional(),
  completed: z.boolean().optional(),
});

export function registerDataIpc(): void {
  /* --------------------------------------------------------------------- *
   * Settings
   * --------------------------------------------------------------------- */

  handle("settings:get", () => getSettings(getDriver()));

  handle("settings:save", (raw: unknown) =>
    saveSettings(getDriver(), parse(settingsSchema, raw, "settings")),
  );

  handle("app:data-dir", () => resolveDataDir());

  /* --------------------------------------------------------------------- *
   * Discovery
   * --------------------------------------------------------------------- */

  handle("search:run", async (raw: unknown) => {
    // The shared schema fills in sources/kinds/page/perPage, so a caller can
    // send just a query string.
    const query = parse(searchQuerySchema, raw, "search query");

    return searchAcrossProviders(getProviderRegistry(), query, {
      signal: AbortSignal.timeout(15_000),
    });
  });

  handle("media:trending", async (raw: unknown) => {
    const kind = parse(mediaKindSchema, raw, "media kind");

    return trendingAcrossProviders(getProviderRegistry(), kind, {
      signal: AbortSignal.timeout(15_000),
    });
  });

  handle("media:details", async (raw: unknown) => {
    const item = parse(mediaItemSchema, raw, "media item");
    const provider = getProviderRegistry().forRef(item);

    if (!provider?.capabilities.details || !provider.getDetails) return null;

    return provider.getDetails(item, {
      signal: AbortSignal.timeout(15_000),
      timeoutMs: 15_000,
    });
  });

  handle("playback:resolve", async (raw: unknown) => {
    const item = parse(mediaItemSchema, raw, "media item");

    return resolvePlayback(getAdapterRegistry(), item, {
      signal: AbortSignal.timeout(15_000),
    });
  });

  /* --------------------------------------------------------------------- *
   * Watchlist
   * --------------------------------------------------------------------- */

  handle("watchlist:list", () => getWatchlist(getDriver()));

  handle("watchlist:add", (raw: unknown) => {
    const input = parse(watchlistAddSchema, raw, "watchlist entry");
    return addToWatchlist(getDriver(), input.item, input.status);
  });

  handle("watchlist:remove", (raw: unknown) =>
    removeFromWatchlist(getDriver(), parse(mediaRefSchema, raw, "media reference")),
  );

  /* --------------------------------------------------------------------- *
   * Progress and history
   * --------------------------------------------------------------------- */

  handle("progress:all", () => getAllProgress(getDriver()));

  handle("progress:save", async (raw: unknown) => {
    const input = parse(progressInputSchema, raw, "progress");
    // The completion threshold is a user preference, so it has to come from
    // settings rather than the repository default.
    const settings = await getSettings(getDriver());

    return saveProgress(getDriver(), {
      ...input,
      markWatchedAt: settings.playback.markWatchedAt,
    });
  });

  handle("progress:clear", (raw: unknown) =>
    clearProgress(getDriver(), parse(mediaRefSchema, raw, "media reference")),
  );

  handle("history:list", () => getHistory(getDriver()));

  handle("history:add", (raw: unknown) =>
    addHistoryEntry(getDriver(), parse(historyAddSchema, raw, "history entry")),
  );

  handle("history:clear", () => clearHistory(getDriver()));

  /* --------------------------------------------------------------------- *
   * Local library
   * --------------------------------------------------------------------- */

  handle("library:files", () => getLocalFiles(getDriver()));

  /* --------------------------------------------------------------------- *
   * Extensions
   * --------------------------------------------------------------------- */

  handle("extensions:list", () => listLoadedExtensions());

  handle("extensions:call", (id: unknown, method: unknown, args: unknown) => {
    const extensionId = parse(z.string().min(1).max(200), id, "extension id");
    const methodName = parse(z.string().min(1).max(100), method, "method name");

    return callExtension(extensionId, methodName, Array.isArray(args) ? args : []);
  });

  /* --------------------------------------------------------------------- *
   * Diagnostics — lets the shell prove the bridge works before a UI exists.
   * --------------------------------------------------------------------- */

  handle("diagnostics:report", async () => {
    const providers = getProviderRegistry()
      .all()
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        available: provider.isAvailable(),
      }));

    const [settings, watchlist, files] = await Promise.all([
      getSettings(getDriver()),
      getWatchlist(getDriver()),
      getLocalFiles(getDriver()),
    ]);

    return {
      dataDir: resolveDataDir(),
      providers,
      adapters: getAdapterRegistry().all().map((adapter) => adapter.id),
      extensions: listLoadedExtensions(),
      counts: {
        watchlist: watchlist.length,
        localFiles: files.length,
      },
      theme: settings.appearance.theme,
    };
  });
}
