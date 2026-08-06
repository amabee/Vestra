import type {
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
    search: (query: unknown) => Promise<unknown>;
    trending: (kind: unknown) => Promise<unknown>;
    details: (item: unknown) => Promise<unknown>;
    resolvePlayback: (item: unknown) => Promise<unknown>;
    probe: (fileId: string) => Promise<unknown>;
    probeAvailable: () => Promise<unknown>;
    skipTimes: (request: unknown) => Promise<unknown>;
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
  };
  extensions: {
    list: () => Promise<unknown>;
    call: (extensionId: string, method: string, args: unknown[]) => Promise<unknown>;
  };
  mpv: {
    status: () => Promise<unknown>;
    subscribe: () => Promise<unknown>;
    open: (request: unknown) => Promise<unknown>;
    setRect: (rect: unknown) => Promise<unknown>;
    play: () => Promise<unknown>;
    pause: () => Promise<unknown>;
    seek: (seconds: number) => Promise<unknown>;
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
  subtitleVisible: boolean;
  error: string | null;
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
  skips: { kind: "opening" | "ending"; startSeconds: number; endSeconds: number }[];
  /** Jump past a range automatically instead of offering a button. */
  autoSkip: boolean;
}

export type PlayerCommand = "next" | "previous" | "close" | "toggle-fullscreen";

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
    get: async (): Promise<Settings> => (await raw().settings.get()) as Settings,
    save: async (settings: Settings): Promise<Settings> =>
      (await raw().settings.save(settings)) as Settings,
  },

  media: {
    search: async (query: string, kinds: MediaKind[] = []): Promise<SearchResponse> =>
      (await raw().media.search({ query, kinds })) as SearchResponse,

    trending: async (kind: MediaKind): Promise<TrendingGroup[]> =>
      (await raw().media.trending(kind)) as TrendingGroup[],

    details: async (item: MediaItem): Promise<MediaDetails | null> =>
      (await raw().media.details(item)) as MediaDetails | null,

    resolvePlayback: async (item: MediaItem): Promise<PlaybackSource[]> =>
      (await raw().media.resolvePlayback(item)) as PlaybackSource[],

    probe: async (fileId: string): Promise<ProbeResult> =>
      (await raw().media.probe(fileId)) as ProbeResult,

    probeAvailable: async (): Promise<{ available: boolean; path: string | null }> =>
      (await raw().media.probeAvailable()) as { available: boolean; path: string | null },

    /** Community-sourced opening and ending timings. Empty when unknown. */
    skipTimes: async (request: {
      source: string;
      sourceId: string;
      seasonNumber: number;
      episodeNumber: number;
      episodeLengthSeconds?: number;
    }): Promise<SkipInterval[]> =>
      (await raw().media.skipTimes(request)) as SkipInterval[],
  },

  watchlist: {
    list: async (): Promise<WatchlistEntry[]> =>
      (await raw().watchlist.list()) as WatchlistEntry[],

    add: async (item: MediaItem, status?: WatchlistStatus): Promise<WatchlistEntry[]> =>
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
    }): Promise<WatchProgress> => (await raw().progress.save(input)) as WatchProgress,

    clear: async (ref: MediaRef): Promise<void> => {
      await raw().progress.clear(ref);
    },
  },

  history: {
    list: async (): Promise<HistoryEntry[]> => (await raw().history.list()) as HistoryEntry[],

    add: async (input: {
      item: MediaItem;
      episodeId?: string | null;
      positionSeconds?: number;
      completed?: boolean;
    }): Promise<HistoryEntry[]> => (await raw().history.add(input)) as HistoryEntry[],

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
  },

  extensions: {
    list: async (): Promise<string[]> => (await raw().extensions.list()) as string[],
    call: (extensionId: string, method: string, args: unknown[] = []): Promise<unknown> =>
      raw().extensions.call(extensionId, method, args),
  },

  mpv: {
    status: async (): Promise<MpvStatus> => (await raw().mpv.status()) as MpvStatus,

    /** Begin receiving state pushes and get the current state in one call. */
    subscribe: async (): Promise<MpvState> => (await raw().mpv.subscribe()) as MpvState,

    open: async (request: {
      fileId: string;
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

    selectTrack: async (type: "audio" | "sub" | "video", id: number | null): Promise<void> => {
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

    /** Whether the overlay should receive pointer events at all. */
    setInteractive: async (interactive: boolean): Promise<void> => {
      await raw().player.setInteractive(interactive);
    },

    onNowPlaying: (listener: (value: NowPlaying | null) => void): (() => void) =>
      raw().player.onNowPlaying((value) => listener(value as NowPlaying | null)),

    onCommand: (listener: (command: PlayerCommand) => void): (() => void) =>
      raw().player.onCommand((command) => listener(command as PlayerCommand)),
  },
};
