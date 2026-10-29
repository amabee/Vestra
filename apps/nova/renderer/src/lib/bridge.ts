import type {
  EpisodeBookmark,
  HistoryEntry,
  LocalFolder,
  LocalMediaFile,
  MediaDetails,
  MediaItem,
  MediaKind,
  MediaRef,
  PlaybackSource,
  SearchResponse,
  Settings,
  WatchlistEntry,
  WatchlistStatus,
  WatchProgress,
} from "@vestra/types";
import type {
  InstallCandidate,
  InstallPlan,
  InstalledExtension,
} from "@vestra/extension-host/install";
import type { MarketplaceEntry } from "@vestra/provider-sdk/marketplace";
import type {
  PickedSource,
  SourceOptions,
  SourceSummary,
} from "../../../shared/sources";

export type {
  InstallCandidate,
  InstallPlan,
  InstalledExtension,
  MarketplaceEntry,
};

/** A registry listing, tagged with the index it came from. */
export type BrowseEntry = MarketplaceEntry & { registryUrl: string };

export interface BrowseResult {
  entries: BrowseEntry[];
  /** Registries that could not be read, rather than a failed browse. */
  errors: { registryUrl: string; message: string }[];
  /** Listings the registry supplied that did not validate. */
  rejected: number;
}

/**
 * The preload bridge, typed.
 *
 * `preload.ts` deliberately types everything as `unknown` — importing zod into
 * a privileged pre-sandbox context to validate what the main process just sent
 * us would be wasted work. The narrowing happens here instead, in the one place
 * that knows what each channel returns.
 *
 * These casts are assertions about a contract the main process already
 * enforces: it validates every inbound payload and builds every response from
 * schema-checked repositories. If a shape is wrong, the bug is there, not here.
 */

interface RawBridge {
  sources: {
    prepareRemote: (url: string) => Promise<unknown>;
    checkUpdates: (id: string) => Promise<unknown>;
    applyRemote: (token: string, hosts: string[]) => Promise<unknown>;
    rollback: (
      id: string,
      revision: string,
      expectedHash: string,
    ) => Promise<unknown>;
    list: () => Promise<unknown>;
    pick: () => Promise<unknown>;
    replace: (
      id: string,
      token: string,
      expectedHash: string,
    ) => Promise<unknown>;
    install: (token: string, options: unknown) => Promise<unknown>;
    update: (id: string, options: unknown) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
    check: (id: string) => Promise<unknown>;
  };
  manga: {
    sources: () => Promise<unknown>;
    recent: (p: string) => Promise<unknown>;
    search: (p: string, q: string) => Promise<unknown>;
    chapters: (p: string, b: string) => Promise<unknown>;
    pages: (p: string, b: string, c: string) => Promise<unknown>;
    image: (h: string) => Promise<unknown>;
    progress: (p: string, b: string) => Promise<unknown>;
    save: (p: string, b: string, c: string, n: number) => Promise<unknown>;
  };
  window: {
    minimize: () => Promise<unknown>;
    toggleMaximize: () => Promise<unknown>;
    close: () => Promise<unknown>;
    setFullscreen: (value: boolean) => Promise<unknown>;
    isFullscreen: () => Promise<unknown>;
  };
  app: {
    getVersion: () => Promise<unknown>;
    getDataDir: () => Promise<unknown>;
    diagnostics: () => Promise<unknown>;
  };
  shell: {
    openExternal: (url: string) => Promise<unknown>;
  };
  settings: {
    get: () => Promise<unknown>;
    save: (settings: unknown) => Promise<unknown>;
  };
  media: {
    streamQualities: (locator: string) => Promise<unknown>;
    search: (query: unknown) => Promise<unknown>;
    trending: (kind: unknown) => Promise<unknown>;
    details: (item: unknown) => Promise<unknown>;
    resolvePlayback: (item: unknown) => Promise<unknown>;
    probe: (fileId: string) => Promise<unknown>;
    probeAvailable: () => Promise<unknown>;
    skipTimes: (request: unknown) => Promise<unknown>;
    reportSkip: (skipId: string) => Promise<unknown>;
  };
  watchlist: {
    list: () => Promise<unknown>;
    add: (input: unknown) => Promise<unknown>;
    remove: (ref: unknown) => Promise<unknown>;
  };
  progress: {
    all: () => Promise<unknown>;
    save: (input: unknown) => Promise<unknown>;
    clear: (ref: unknown) => Promise<unknown>;
  };
  bookmarks: {
    all: () => Promise<unknown>;
    toggle: (input: unknown) => Promise<unknown>;
  };
  history: {
    list: () => Promise<unknown>;
    add: (input: unknown) => Promise<unknown>;
    clear: () => Promise<unknown>;
  };
  library: {
    files: () => Promise<unknown>;
    entries: () => Promise<unknown>;
    folders: () => Promise<unknown>;
    pickFolder: () => Promise<unknown>;
    removeFolder: (id: string) => Promise<unknown>;
    scan: () => Promise<unknown>;
    rematch: () => Promise<unknown>;
    onChanged: (listener: () => void) => () => void;
  };
  extensions: {
    list: () => Promise<unknown>;
    call: (
      extensionId: string,
      method: string,
      args: unknown[],
    ) => Promise<unknown>;
    installed: () => Promise<unknown>;
    registries: () => Promise<unknown>;
    setRegistries: (urls: unknown) => Promise<unknown>;
    browse: () => Promise<unknown>;
    prepare: (candidate: unknown) => Promise<unknown>;
    install: (request: unknown) => Promise<unknown>;
    uninstall: (id: string) => Promise<unknown>;
    pickUnpacked: () => Promise<unknown>;
    installUnpacked: (request: unknown) => Promise<unknown>;
  };
  mpv: {
    status: () => Promise<unknown>;
    subscribe: () => Promise<unknown>;
    open: (request: unknown) => Promise<unknown>;
    setRect: (rect: unknown) => Promise<unknown>;
    play: () => Promise<unknown>;
    pause: () => Promise<unknown>;
    seek: (seconds: number) => Promise<unknown>;
    seekBy: (delta: number) => Promise<unknown>;
    setVolume: (volume: number) => Promise<unknown>;
    setMuted: (muted: boolean) => Promise<unknown>;
    setSpeed: (speed: number) => Promise<unknown>;
    setSubtitleDelay: (seconds: number) => Promise<unknown>;
    setSubtitleScale: (scale: number) => Promise<unknown>;
    setSubtitleStyleOverride: (enabled: boolean) => Promise<unknown>;
    setSurfaceVisible: (visible: boolean) => Promise<unknown>;
    selectTrack: (selection: unknown) => Promise<unknown>;
    setSubtitleVisible: (visible: boolean) => Promise<unknown>;
    close: () => Promise<unknown>;
    onState: (listener: (state: unknown) => void) => () => void;
  };
  player: {
    setNowPlaying: (value: unknown) => Promise<unknown>;
    getNowPlaying: () => Promise<unknown>;
    send: (command: string) => Promise<unknown>;
    focus: () => Promise<unknown>;
    drag: (payload: unknown) => Promise<unknown>;
    toggleMaximize: () => Promise<unknown>;
    setInteractive: (interactive: boolean) => Promise<unknown>;
    onNowPlaying: (listener: (value: unknown) => void) => () => void;
    onCommand: (listener: (command: string) => void) => () => void;
  };
  platform: string;
}

declare global {
  interface Window {
    vestra?: RawBridge;
  }
}

export class BridgeUnavailableError extends Error {
  constructor() {
    super(
      "The Vestra bridge is unavailable. The preload script failed to load — " +
        "check the terminal for a [renderer:error] line.",
    );
    this.name = "BridgeUnavailableError";
  }
}

function raw(): RawBridge {
  const bridge = window.vestra;
  // Fail loudly. A silently missing bridge presents as an app where nothing
  // loads and nothing explains why.
  if (!bridge) throw new BridgeUnavailableError();
  return bridge;
}

export interface TrendingGroup {
  providerId: string;
  providerName: string;
  items: MediaItem[];
  error: string | null;
}

export interface Diagnostics {
  dataDir: string;
  providers: { id: string; name: string; available: boolean }[];
  adapters: string[];
  extensions: string[];
  counts: { watchlist: number; localFiles: number };
  theme: string;
}

export interface ScanSummary {
  scanned: number;
  added: number;
  removed: number;
  errors: string[];
  matched: number;
  unmatched: number;
}

/** A work in the local library, with the files that make it up. */
export interface LibraryEntry {
  item: MediaItem;
  matched: boolean;
  files: LocalMediaFile[];
  totalBytes: number;
}

export interface MediaStreamInfo {
  index: number;
  codec: string;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
}

export interface ChapterInfo {
  startSeconds: number;
  endSeconds: number;
  title: string | null;
}

export interface SkipPoint {
  kind: "opening" | "ending";
  startSeconds: number;
  endSeconds: number;
}

export interface ProbeResult {
  durationSeconds: number | null;
  container: string | null;
  video: (MediaStreamInfo & {
    width: number | null;
    height: number | null;
    bitDepth: number | null;
  })[];
  audio: (MediaStreamInfo & { channels: number | null })[];
  subtitles: MediaStreamInfo[];
  chapters: ChapterInfo[];
  playable: { video: boolean; audio: boolean; reasons: string[] };
  skipPoints: SkipPoint[];
}

/** A track mpv is aware of, muxed or external. */
export interface MpvTrack {
  id: number;
  type: "video" | "audio" | "sub";
  title: string | null;
  language: string | null;
  codec: string | null;
  selected: boolean;
  external: boolean;
}

export interface MpvChapter {
  title: string | null;
  startSeconds: number;
}

export interface MpvState {
  running: boolean;
  idle: boolean;
  paused: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  speed: number;
  subtitleDelay: number;
  subtitleScale: number;
  ended: boolean;
  tracks: MpvTrack[];
  /** Chapters muxed into the file, in order. Usually empty. */
  chapters: MpvChapter[];
  subtitleVisible: boolean;
  error: string | null;
  subtitleError: string | null;
}

export interface MpvStatus {
  available: boolean;
  path: string | null;
  running: boolean;
}

/** What the controls window shows that mpv cannot tell it. */
export interface NowPlaying {
  title: string;
  episodeLabel: string | null;
  index: number;
  total: number;
  engine: "mpv" | "builtin";
  /** Opening and ending ranges for the episode playing, if any are known. */
  skips: {
    kind: "opening" | "ending";
    startSeconds: number;
    endSeconds: number;
    /** Null when the range came from the file's own chapters. */
    skipId: string | null;
  }[];
  /** Jump past a range automatically instead of offering a button. */
  autoSkip: boolean;
  /** Counts up per playback, so replaying one episode is not one session. */
  sessionId: number;
}

export type PlayerCommand =
  "next" | "previous" | "close" | "toggle-fullscreen" | "open-settings";

/** An opening or ending range, from AniSkip. */
export interface SkipInterval {
  kind: "opening" | "ending";
  startSeconds: number;
  endSeconds: number;
}

/** Where the video surface should sit, in CSS pixels within the window. */
export interface SurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const bridge = {
  sources: {
    prepareRemote: (url: string) =>
      raw().sources.prepareRemote(url) as Promise<
        import("../../../shared/sources").RemoteSourcePlan
      >,
    checkUpdates: (id: string) =>
      raw().sources.checkUpdates(id) as Promise<
        import("../../../shared/sources").RemoteSourcePlan
      >,
    applyRemote: (token: string, hosts: string[]) =>
      raw().sources.applyRemote(token, hosts),
    rollback: (id: string, revision: string, expectedHash: string) =>
      raw().sources.rollback(id, revision, expectedHash),
    list: () => raw().sources.list() as Promise<SourceSummary[]>,
    pick: () => raw().sources.pick() as Promise<PickedSource | null>,
    replace: (id: string, token: string, expectedHash: string) =>
      raw().sources.replace(id, token, expectedHash),
    install: (token: string, options: SourceOptions) =>
      raw().sources.install(token, options),
    update: (id: string, options: SourceOptions & { enabled: boolean }) =>
      raw().sources.update(id, options),
    remove: (id: string) => raw().sources.remove(id),
    check: (id: string) => raw().sources.check(id),
  },
  manga: {
    recent: (p: string) =>
      raw().manga.recent(p) as Promise<
        import("../../../shared/manga").MangaRecent
      >,
    sources: async () =>
      (await raw().manga.sources()) as { id: string; name: string }[],
    search: async (p: string, q: string) =>
      (await raw().manga.search(
        p,
        q,
      )) as import("../../../shared/manga").MangaBook[],
    chapters: async (p: string, b: string) =>
      (await raw().manga.chapters(
        p,
        b,
      )) as import("../../../shared/manga").MangaChapter[],
    pages: async (p: string, b: string, c: string) =>
      (await raw().manga.pages(
        p,
        b,
        c,
      )) as import("../../../shared/manga").MangaPage[],
    image: async (h: string) => (await raw().manga.image(h)) as string,
    progress: async (p: string, b: string) =>
      (await raw().manga.progress(p, b)) as
        import("../../../shared/manga").ReadingProgress | null,
    save: async (p: string, b: string, c: string, n: number) => {
      await raw().manga.save(p, b, c, n);
    },
  },
  platform: (): string => raw().platform,

  window: {
    minimize: () => raw().window.minimize(),
    toggleMaximize: () => raw().window.toggleMaximize(),
    close: () => raw().window.close(),

    /** Returns the state the window actually ended up in. */
    setFullscreen: async (value: boolean): Promise<boolean> =>
      (await raw().window.setFullscreen(value)) === true,

    isFullscreen: async (): Promise<boolean> =>
      (await raw().window.isFullscreen()) === true,
  },

  app: {
    version: async (): Promise<string> => String(await raw().app.getVersion()),
    dataDir: async (): Promise<string> => String(await raw().app.getDataDir()),
    diagnostics: async (): Promise<Diagnostics> =>
      (await raw().app.diagnostics()) as Diagnostics,
  },

  shell: {
    openExternal: async (url: string): Promise<void> => {
      await raw().shell.openExternal(url);
    },
  },

  settings: {
    get: async (): Promise<Settings> =>
      (await raw().settings.get()) as Settings,
    save: async (settings: Settings): Promise<Settings> =>
      (await raw().settings.save(settings)) as Settings,
  },

  media: {
    search: async (
      query: string,
      kinds: MediaKind[] = [],
    ): Promise<SearchResponse> =>
      (await raw().media.search({ query, kinds })) as SearchResponse,

    trending: async (kind: MediaKind): Promise<TrendingGroup[]> =>
      (await raw().media.trending(kind)) as TrendingGroup[],

    details: async (item: MediaItem): Promise<MediaDetails | null> =>
      (await raw().media.details(item)) as MediaDetails | null,

    streamQualities: (locator: string) =>
      raw().media.streamQualities(locator) as Promise<
        { locator: string; label: string }[]
      >,
    resolvePlayback: async (item: MediaItem): Promise<PlaybackSource[]> =>
      (await raw().media.resolvePlayback(item)) as PlaybackSource[],

    probe: async (fileId: string): Promise<ProbeResult> =>
      (await raw().media.probe(fileId)) as ProbeResult,

    probeAvailable: async (): Promise<{
      available: boolean;
      path: string | null;
    }> =>
      (await raw().media.probeAvailable()) as {
        available: boolean;
        path: string | null;
      },

    /** Community-sourced opening and ending timings. Empty when unknown. */
    skipTimes: async (request: {
      source: string;
      sourceId: string;
      seasonNumber: number;
      episodeNumber: number;
      episodeLengthSeconds?: number;
    }): Promise<SkipInterval[]> =>
      (await raw().media.skipTimes(request)) as SkipInterval[],

    /** Vote a wrong timing down. Resolves false if the vote did not land. */
    reportSkip: async (skipId: string): Promise<boolean> =>
      (await raw().media.reportSkip(skipId)) as boolean,
  },

  watchlist: {
    list: async (): Promise<WatchlistEntry[]> =>
      (await raw().watchlist.list()) as WatchlistEntry[],

    add: async (
      item: MediaItem,
      status?: WatchlistStatus,
    ): Promise<WatchlistEntry[]> =>
      (await raw().watchlist.add({ item, status })) as WatchlistEntry[],

    remove: async (ref: MediaRef): Promise<WatchlistEntry[]> =>
      (await raw().watchlist.remove(ref)) as WatchlistEntry[],
  },

  progress: {
    all: async (): Promise<Record<string, WatchProgress>> =>
      (await raw().progress.all()) as Record<string, WatchProgress>,

    save: async (input: {
      ref: MediaRef;
      episodeId?: string | null;
      positionSeconds: number;
      durationSeconds: number;
    }): Promise<WatchProgress> =>
      (await raw().progress.save(input)) as WatchProgress,

    clear: async (ref: MediaRef): Promise<void> => {
      await raw().progress.clear(ref);
    },
  },

  bookmarks: {
    all: async (): Promise<Record<string, EpisodeBookmark>> =>
      (await raw().bookmarks.all()) as Record<string, EpisodeBookmark>,

    toggle: async (input: {
      ref: MediaRef;
      episodeId?: string | null;
    }): Promise<{
      bookmarked: boolean;
      entries: Record<string, EpisodeBookmark>;
    }> =>
      (await raw().bookmarks.toggle(input)) as {
        bookmarked: boolean;
        entries: Record<string, EpisodeBookmark>;
      },
  },

  history: {
    list: async (): Promise<HistoryEntry[]> =>
      (await raw().history.list()) as HistoryEntry[],

    add: async (input: {
      item: MediaItem;
      episodeId?: string | null;
      positionSeconds?: number;
      completed?: boolean;
    }): Promise<HistoryEntry[]> =>
      (await raw().history.add(input)) as HistoryEntry[],

    clear: async (): Promise<void> => {
      await raw().history.clear();
    },
  },

  library: {
    files: async (): Promise<LocalMediaFile[]> =>
      (await raw().library.files()) as LocalMediaFile[],

    entries: async (): Promise<LibraryEntry[]> =>
      (await raw().library.entries()) as LibraryEntry[],

    folders: async (): Promise<LocalFolder[]> =>
      (await raw().library.folders()) as LocalFolder[],

    /** Returns null when the user cancels the native picker. */
    pickFolder: async (): Promise<LocalFolder[] | null> =>
      (await raw().library.pickFolder()) as LocalFolder[] | null,

    removeFolder: async (id: string): Promise<LocalFolder[]> =>
      (await raw().library.removeFolder(id)) as LocalFolder[],

    scan: async (): Promise<ScanSummary> =>
      (await raw().library.scan()) as ScanSummary,

    /** Re-identify every file, including ones already matched. */
    rematch: async (): Promise<{
      matched: number;
      unmatched: number;
      reidentified: number;
      remapped: number;
    }> =>
      (await raw().library.rematch()) as {
        matched: number;
        unmatched: number;
        reidentified: number;
        remapped: number;
      },

    /** Returns an unsubscribe function. */
    onChanged: (listener: () => void): (() => void) =>
      raw().library.onChanged(listener),
  },

  extensions: {
    list: async (): Promise<string[]> =>
      (await raw().extensions.list()) as string[],
    call: (
      extensionId: string,
      method: string,
      args: unknown[] = [],
    ): Promise<unknown> => raw().extensions.call(extensionId, method, args),

    installed: async (): Promise<InstalledExtension[]> =>
      (await raw().extensions.installed()) as InstalledExtension[],

    registries: async (): Promise<string[]> =>
      (await raw().extensions.registries()) as string[],

    setRegistries: async (urls: string[]): Promise<string[]> =>
      (await raw().extensions.setRegistries(urls)) as string[],

    browse: async (): Promise<BrowseResult> =>
      (await raw().extensions.browse()) as BrowseResult,

    /** Reads the manifest so the user can see what they are agreeing to. */
    prepare: async (candidate: InstallCandidate): Promise<InstallPlan> =>
      (await raw().extensions.prepare(candidate)) as InstallPlan,

    install: async (request: {
      candidate: InstallCandidate;
      granted: string[];
    }): Promise<InstalledExtension> =>
      (await raw().extensions.install(request)) as InstalledExtension,

    uninstall: async (id: string): Promise<InstalledExtension[]> =>
      (await raw().extensions.uninstall(id)) as InstalledExtension[],

    /** Opens the OS folder picker. Null when the user cancels. */
    pickUnpacked: async (): Promise<InstallPlan | null> =>
      (await raw().extensions.pickUnpacked()) as InstallPlan | null,

    installUnpacked: async (request: {
      folder: string;
      granted: string[];
    }): Promise<InstalledExtension> =>
      (await raw().extensions.installUnpacked(request)) as InstalledExtension,
  },

  mpv: {
    status: async (): Promise<MpvStatus> =>
      (await raw().mpv.status()) as MpvStatus,

    /** Begin receiving state pushes and get the current state in one call. */
    subscribe: async (): Promise<MpvState> =>
      (await raw().mpv.subscribe()) as MpvState,

    open: async (request: {
      fileId?: string;
      streamLocator?: string;
      startSeconds?: number;
      rect: SurfaceRect;
    }): Promise<MpvState> => (await raw().mpv.open(request)) as MpvState,

    setRect: async (rect: SurfaceRect): Promise<void> => {
      await raw().mpv.setRect(rect);
    },

    play: async (): Promise<void> => {
      await raw().mpv.play();
    },

    pause: async (): Promise<void> => {
      await raw().mpv.pause();
    },

    seek: async (seconds: number): Promise<void> => {
      await raw().mpv.seek(seconds);
    },

    /** Offset from mpv's own position, so repeated presses accumulate. */
    seekBy: async (delta: number): Promise<void> => {
      await raw().mpv.seekBy(delta);
    },

    setVolume: async (volume: number): Promise<void> => {
      await raw().mpv.setVolume(volume);
    },

    setMuted: async (muted: boolean): Promise<void> => {
      await raw().mpv.setMuted(muted);
    },

    setSpeed: async (speed: number): Promise<void> => {
      await raw().mpv.setSpeed(speed);
    },

    setSubtitleDelay: async (seconds: number): Promise<void> => {
      await raw().mpv.setSubtitleDelay(seconds);
    },

    setSubtitleScale: async (scale: number): Promise<void> => {
      await raw().mpv.setSubtitleScale(scale);
    },

    setSubtitleStyleOverride: async (enabled: boolean): Promise<void> => {
      await raw().mpv.setSubtitleStyleOverride(enabled);
    },

    /** Step the video surface aside so an overlay can be seen. */
    setSurfaceVisible: async (visible: boolean): Promise<void> => {
      await raw().mpv.setSurfaceVisible(visible);
    },

    selectTrack: async (
      type: "audio" | "sub" | "video",
      id: number | null,
    ): Promise<void> => {
      await raw().mpv.selectTrack({ type, id });
    },

    setSubtitleVisible: async (visible: boolean): Promise<void> => {
      await raw().mpv.setSubtitleVisible(visible);
    },

    close: async (): Promise<void> => {
      await raw().mpv.close();
    },

    onState: (listener: (state: MpvState) => void): (() => void) =>
      raw().mpv.onState((state) => listener(state as MpvState)),
  },

  player: {
    setNowPlaying: async (value: NowPlaying): Promise<void> => {
      await raw().player.setNowPlaying(value);
    },

    getNowPlaying: async (): Promise<NowPlaying | null> =>
      (await raw().player.getNowPlaying()) as NowPlaying | null,

    send: async (command: PlayerCommand): Promise<void> => {
      await raw().player.send(command);
    },

    /** Return focus to the interface window, which owns the shortcuts. */
    focus: async (): Promise<void> => {
      await raw().player.focus();
    },

    /** Move the window beneath the player by a pointer delta. */
    drag: async (phase: "start" | "move", dx = 0, dy = 0): Promise<void> => {
      await raw().player.drag({ phase, dx, dy });
    },

    toggleMaximize: async (): Promise<void> => {
      await raw().player.toggleMaximize();
    },

    /** Whether the overlay should receive pointer events at all. */
    setInteractive: async (interactive: boolean): Promise<void> => {
      await raw().player.setInteractive(interactive);
    },

    onNowPlaying: (
      listener: (value: NowPlaying | null) => void,
    ): (() => void) =>
      raw().player.onNowPlaying((value) =>
        listener(value as NowPlaying | null),
      ),

    onCommand: (listener: (command: PlayerCommand) => void): (() => void) =>
      raw().player.onCommand((command) => listener(command as PlayerCommand)),
  },
};
