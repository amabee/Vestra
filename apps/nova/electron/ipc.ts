import { randomUUID } from "node:crypto";

import {
  addHistoryEntry,
  addToWatchlist,
  clearHistory,
  clearProgress,
  getAllProgress,
  getBookmarks,
  getHistory,
  getLocalFiles,
  getSettings,
  getWatchlist,
  removeFromWatchlist,
  remapEpisodeKeys,
  saveProgress,
  saveSettings,
  toggleBookmark,
} from "@vestra/storage";
import { resolvePlayback, searchAcrossProviders, trendingAcrossProviders } from "@vestra/provider-sdk";
import {
  extensionTypeSchema,
  parseRegistry,
  type MarketplaceEntry,
} from "@vestra/provider-sdk/marketplace";
import {
  completeInstall,
  prepareInstall,
} from "@vestra/extension-host/install";
import {
  listInstalled,
  removeInstalled,
  saveInstalled,
} from "@vestra/extension-host/store";
import {
  mediaItemSchema,
  mediaKey,
  mediaKindSchema,
  mediaRefSchema,
  searchQuerySchema,
  settingsSchema,
  watchlistStatusSchema,
  type MediaItem,
} from "@vestra/types";
import { getSkipTimes, matchLibrary, reportSkipTime, scanLibrary } from "@vestra/providers";
import { ipcMain, shell, dialog } from "electron";
import { z } from "zod";

import {
  callExtension,
  listLoadedExtensions,
  loadExtension,
  transport,
  unloadExtension,
} from "./extensions";
import { buildLibraryEntries } from "./library-entries";
import { attachExtensionProvider, detachExtensionProvider } from "./extension-providers";
import { probeMedia, resolveFfprobe, skipPointsFrom } from "./media-probe";
import { safeFetch } from "./safe-fetch";
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

const bookmarkInputSchema = z.object({
  ref: mediaRefSchema,
  episodeId: z.string().max(200).nullable().default(null),
});

/**
 * A registry listing the user picked out.
 *
 * Bounded on the way in because everything here came from a third-party index
 * and arrives via the renderer. The URLs are checked again by the transport,
 * and the type is checked again by `assertLoadable` inside the install.
 */
const installCandidateSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(300),
  version: z.string().min(1).max(60),
  type: extensionTypeSchema,
  manifestURI: z.string().url().max(2000),
  payloadURI: z.string().url().max(2000),
  registryUrl: z.string().url().max(2000),
});

const installRequestSchema = z.object({
  candidate: installCandidateSchema,
  granted: z.array(z.string().max(100)).max(20).default([]),
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

const skipTimesSchema = z.object({
  source: z.string().max(50),
  sourceId: z.string().max(100),
  seasonNumber: z.number().int().min(1).max(99).default(1),
  episodeNumber: z.number().int().min(1).max(9999),
  episodeLengthSeconds: z.number().min(0).max(360_000).default(0),
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

  /**
   * Lookups take a reference, not a whole item.
   *
   * Providers resolve by identity — AniList's `getDetails` reads nothing but
   * `sourceId`, and adapters dispatch on `source` and `kind`. Demanding a full
   * `MediaItem` here meant the detail page, which only has a ref from the URL,
   * failed validation and silently rendered as empty.
   *
   * The cast is safe for that reason: nothing downstream touches the fields a
   * ref lacks.
   */
  handle("media:details", async (raw: unknown) => {
    const ref = parse(mediaRefSchema, raw, "media reference") as MediaItem;
    const provider = getProviderRegistry().forRef(ref);

    if (!provider?.capabilities.details || !provider.getDetails) return null;

    return provider.getDetails(ref, {
      signal: AbortSignal.timeout(15_000),
      timeoutMs: 15_000,
    });
  });

  handle("playback:resolve", async (raw: unknown) => {
    const ref = parse(mediaRefSchema, raw, "media reference") as MediaItem;

    return resolvePlayback(getAdapterRegistry(), ref, {
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

  handle("bookmarks:all", () => getBookmarks(getDriver()));

  handle("bookmarks:toggle", (raw: unknown) => {
    const input = parse(bookmarkInputSchema, raw, "bookmark");
    return toggleBookmark(getDriver(), input.ref, input.episodeId ?? null);
  });

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

  /**
   * Inspect a local file.
   *
   * Takes a file id rather than a path, for the same reason the media protocol
   * does: the renderer should never name a location on disk, and only files
   * already in the library index can be reached.
   */
  handle("media:probe", async (raw: unknown) => {
    const fileId = parse(z.string().min(1).max(200), raw, "file id");

    const files = await getLocalFiles(getDriver());
    const file = files.find((entry) => entry.id === fileId);
    if (!file) throw new Error("That file is not in the library.");

    const probe = await probeMedia(file.path);

    return { ...probe, skipPoints: skipPointsFrom(probe.chapters) };
  });

  /** Whether probing is available at all, so the UI can say so plainly. */
  handle("media:probe-available", () => {
    const binary = resolveFfprobe();
    return { available: binary !== null, path: binary };
  });

  /**
   * Opening and ending timings for an episode.
   *
   * Sourced from AniSkip rather than the file: releases almost never carry
   * chapter markers, and inferring an opening from timings alone would cut
   * into cold opens. An empty list means nobody has submitted timings for this
   * episode, which is ordinary — the player simply offers no skip control.
   */
  handle("media:skip-times", async (raw: unknown) => {
    const { source, sourceId, seasonNumber, episodeNumber, episodeLengthSeconds } =
      parse(skipTimesSchema, raw, "skip request");

    // Only AniList references can be mapped to a MyAnimeList id, which is what
    // AniSkip is keyed by.
    if (source !== "anilist") return [];

    return getSkipTimes(sourceId, seasonNumber, episodeNumber, episodeLengthSeconds);
  });

  /**
   * Tell AniSkip a timing is wrong.
   *
   * A write to a shared database, so it is kept narrow: one id, always a
   * downvote, and only ever reached from an explicit action in the player.
   * The id must be one AniSkip issued, which is a uuid.
   */
  handle("media:report-skip", (raw: unknown) =>
    reportSkipTime(parse(z.string().uuid(), raw, "skip id")),
  );

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

  /**
   * Identify everything again, including files that already carry a match.
   *
   * Separate from scanning because it is a repair rather than routine work.
   * A scan deliberately leaves existing matches alone, so a library matched by
   * an older build keeps whatever it was given — including matches made before
   * the matcher understood that AniList files each season separately.
   */
  handle("library:rematch", async () => {
    const driver = getDriver();

    // Captured before the walk, so files whose identity moves can take their
    // watch history with them.
    const before = new Map(
      (await getLocalFiles(driver)).map((file) => [file.id, file.matchedRef]),
    );

    const result = await matchLibrary(driver, getProviderRegistry(), {
      force: true,
    });

    const moves = result.files.flatMap((file) => {
      const from = before.get(file.id);
      const to = file.matchedRef;
      if (!from || !to || mediaKey(from) === mediaKey(to)) return [];
      return [{ episodeId: file.id, from, to }];
    });

    const remapped = await remapEpisodeKeys(driver, moves);

    return {
      matched: result.matched,
      unmatched: result.unmatched,
      reidentified: moves.length,
      remapped: remapped.progress,
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

  handle("extensions:installed", () => listInstalled(getDriver()));

  handle("extensions:registries", async () => {
    const settings = await getSettings(getDriver());
    return settings.extensions.registries;
  });

  /**
   * Add or remove a registry the user wants to browse.
   *
   * Vestra ships none. Pointing the app at a third-party index is a decision
   * the user makes explicitly, and it is recorded in their settings rather
   * than compiled in.
   */
  handle("extensions:set-registries", async (raw: unknown) => {
    const registries = parse(
      z.array(z.string().url().max(2000)).max(20),
      raw,
      "registry list",
    );

    const settings = await getSettings(getDriver());
    const saved = await saveSettings(getDriver(), {
      ...settings,
      extensions: { ...settings.extensions, registries },
    });

    return saved.extensions.registries;
  });

  /**
   * Everything the configured registries list.
   *
   * A registry that fails is reported alongside the entries rather than
   * failing the whole browse: one unreachable index should not hide the others.
   */
  handle("extensions:browse", async () => {
    const settings = await getSettings(getDriver());
    const entries: (MarketplaceEntry & { registryUrl: string })[] = [];
    const errors: { registryUrl: string; message: string }[] = [];
    let rejected = 0;

    for (const registryUrl of settings.extensions.registries) {
      try {
        const response = await safeFetch({ url: registryUrl });
        if (response.status !== 200) {
          errors.push({ registryUrl, message: `Returned status ${response.status}.` });
          continue;
        }

        const parsed = parseRegistry(JSON.parse(response.body));
        rejected += parsed.rejected;

        for (const entry of parsed.entries) entries.push({ ...entry, registryUrl });
      } catch (error) {
        errors.push({
          registryUrl,
          message: error instanceof Error ? error.message : "Could not be read.",
        });
      }
    }

    return { entries, errors, rejected };
  });

  /**
   * Phase one of an install — read the manifest, decide if it is installable.
   *
   * Returns what the user is being asked to agree to. Nothing is written and
   * no code is downloaded until they answer.
   */
  handle("extensions:prepare", async (raw: unknown) => {
    const candidate = parse(installCandidateSchema, raw, "extension");
    return prepareInstall(candidate, transport);
  });

  /**
   * Phase two — download the code, record the grant, start it.
   *
   * `granted` is what the user agreed to, which may be less than the manifest
   * asked for. It is passed through untouched; the host attaches only these.
   */
  handle("extensions:install", async (raw: unknown) => {
    const input = parse(installRequestSchema, raw, "install request");

    const plan = await prepareInstall(input.candidate, transport);

    // Re-read rather than trusting the plan that came back over IPC: the
    // renderer could return anything, and the permissions being granted have
    // to be checked against the manifest that is actually being installed.
    const granted = plan.manifest.permissions.filter((permission) =>
      input.granted.includes(permission),
    );

    const { record, source } = await completeInstall(plan, granted, transport);

    await saveInstalled(getDriver(), record, source);
    const methods = await loadExtension({
      extensionId: record.id,
      source,
      grant: record.grant,
    });

    attachExtensionProvider(record, methods);

    return record;
  });

  handle("extensions:uninstall", async (raw: unknown) => {
    const id = parse(z.string().min(1).max(200), raw, "extension id");

    detachExtensionProvider(id);
    await unloadExtension(id);
    await removeInstalled(getDriver(), id);

    return listInstalled(getDriver());
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
