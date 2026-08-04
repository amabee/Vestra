import type {
  HistoryEntry,
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
  };
  extensions: {
    list: () => Promise<unknown>;
    call: (extensionId: string, method: string, args: unknown[]) => Promise<unknown>;
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

export const bridge = {
  platform: (): string => raw().platform,

  window: {
    minimize: () => raw().window.minimize(),
    toggleMaximize: () => raw().window.toggleMaximize(),
    close: () => raw().window.close(),
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
  },

  extensions: {
    list: async (): Promise<string[]> => (await raw().extensions.list()) as string[],
    call: (extensionId: string, method: string, args: unknown[] = []): Promise<unknown> =>
      raw().extensions.call(extensionId, method, args),
  },
};
