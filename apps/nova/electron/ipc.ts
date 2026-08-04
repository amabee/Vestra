import { randomUUID } from "node:crypto";

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
import { matchLibrary, scanLibrary } from "@vestra/providers";
import { ipcMain, shell, dialog } from "electron";
import { z } from "zod";

import {
  callExtension,
  listLoadedExtensions,
} from "./extensions";
import { buildLibraryEntries } from "./library-entries";
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

/**
 * Force a response into something structured-cloneable.
 *
 * Electron clones IPC payloads, and anything holding a function throws "An
 * object could not be cloned" at runtime with no compile-time warning. Package
 * APIs legitimately return live objects — `TrendingResult.provider` is a whole
 * `MetadataProvider` with methods — so the boundary strips them rather than
 * trusting every present and future handler to remember.
 *
 * Everything crossing here is already schema-validated plain data, so a JSON
 * round-trip loses nothing real.
 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

/** Wraps a handler so a thrown error reaches the renderer as a message, not a stack. */
function handle<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => Promise<TResult> | TResult,
): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    try {
      return plain(await handler(...(args as TArgs)));
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

  /**
   * Open a URL in the system browser.
   *
   * https only. `shell.openExternal` will happily hand the OS a `file://` or a
   * custom scheme, which turns a link in provider metadata into arbitrary
   * local execution.
   */
  handle("shell:open-external", async (raw: unknown) => {
    const url = parse(z.string().url().max(2048), raw, "URL");
    if (!url.startsWith("https://")) {
      throw new Error("Only https links can be opened.");
    }
    await shell.openExternal(url);
    return null;
  });

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

    const results = await trendingAcrossProviders(getProviderRegistry(), kind, {
      signal: AbortSignal.timeout(15_000),
    });

    // Flatten the live provider reference to its identity. The renderer only
    // ever needs to name the source, never to call it.
    return results.map((result) => ({
      providerId: result.provider.id,
      providerName: result.provider.name,
      items: result.items,
      error: result.error,
    }));
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

  /**
   * The library as works, not files.
   *
   * A scanned file stores only a `matchedRef` — no title, no artwork — so a
   * list of files has nothing to show. This resolves those refs to real
   * metadata and groups the files under them, which is also why it is cheap:
   * two hundred episodes of one series is one lookup, not two hundred.
   *
   * Results are cached for the life of the process. Provider metadata does not
   * change between launches often enough to justify refetching every time the
   * user opens the screen.
   */
  handle("library:entries", () => buildLibraryEntries());

  handle("library:folders", async () => {
    const settings = await getSettings(getDriver());
    return settings.library.folders;
  });

  /**
   * Pick a folder through the OS dialog rather than a text field.
   *
   * A typed path is the one place a user can hand the scanner something that
   * does not exist, or that they cannot read. The native picker cannot produce
   * either, so the whole class of error disappears.
   */
  handle("library:pick-folder", async () => {
    const result = await dialog.showOpenDialog({
      title: "Add a media folder",
      properties: ["openDirectory", "createDirectory"],
    });

    if (result.canceled || !result.filePaths[0]) return null;

    const chosen = result.filePaths[0];
    const driver = getDriver();
    const settings = await getSettings(driver);

    if (settings.library.folders.some((folder) => folder.path === chosen)) {
      return settings.library.folders;
    }

    const updated = await saveSettings(driver, {
      ...settings,
      library: {
        ...settings.library,
        folders: [
          ...settings.library.folders,
          {
            id: randomUUID(),
            path: chosen,
            label: null,
            enabled: true,
            lastScannedAt: null,
            fileCount: 0,
          },
        ],
      },
    });

    return updated.library.folders;
  });

  handle("library:remove-folder", async (raw: unknown) => {
    const id = parse(z.string().min(1).max(200), raw, "folder id");
    const driver = getDriver();
    const settings = await getSettings(driver);

    const updated = await saveSettings(driver, {
      ...settings,
      library: {
        ...settings.library,
        folders: settings.library.folders.filter((folder) => folder.id !== id),
      },
    });

    return updated.library.folders;
  });

  /**
   * Walk the configured folders, then match what was found.
   *
   * Matching runs in the same call because a scan that indexes files without
   * identifying them leaves the library in a state the UI cannot present:
   * paths with no titles, no artwork and nothing to link to.
   */
  handle("library:scan", async () => {
    const driver = getDriver();
    const settings = await getSettings(driver);

    const scan = await scanLibrary(driver, settings.library);

    const match = settings.library.autoMatchMetadata
      ? await matchLibrary(driver, getProviderRegistry())
      : { matched: 0, unmatched: 0 };

    return {
      scanned: scan.scanned,
      added: scan.added,
      removed: scan.removed,
      errors: scan.errors,
      matched: match.matched,
      unmatched: match.unmatched,
    };
  });

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
