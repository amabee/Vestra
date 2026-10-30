import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload bridge.
 *
 * Context isolation is on, so the renderer gets exactly this object and nothing
 * else — no `require`, no Node globals, no arbitrary IPC. Every method maps to
 * a channel explicitly registered in the main process, and the main process
 * re-validates every payload rather than trusting that it came from here.
 *
 * Types stay loose (`unknown`). Importing `@vestra/types` would pull zod into
 * the preload bundle, which runs privileged and before the sandbox applies;
 * the renderer can narrow these itself.
 */

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(channel, ...args);

const api = {
  playlists: {
    list: () => invoke("anime:playlists"),
    mutate: (command: unknown) => invoke("anime:playlist-command", command),
  },
  anime: {
    open: (id: string, item: unknown) => invoke("anime:open", id, item),
    resolve: (id: string, ref: unknown) => invoke("anime:resolve", id, ref),
    sources: () => invoke("anime:sources"),
    search: (id: string, query: string) => invoke("anime:search", id, query),
    title: (handle: string) => invoke("anime:title", handle),
    episodes: (handle: string) => invoke("anime:episodes", handle),
  },
  sources: {
    prepareRemote: (url: string) => invoke("sources:remote-prepare", url),
    checkUpdates: (id: string) => invoke("sources:remote-check", id),
    applyRemote: (token: string, hosts: string[]) =>
      invoke("sources:remote-apply", token, hosts),
    rollback: (id: string, revision: string, expectedHash: string) =>
      invoke("sources:rollback", id, revision, expectedHash),
    list: () => invoke("sources:list"),
    pick: () => invoke("sources:pick"),
    replace: (id: string, token: string, expectedHash: string) =>
      invoke("sources:replace", id, token, expectedHash),
    install: (token: string, options: unknown) =>
      invoke("sources:install", token, options),
    update: (id: string, options: unknown) =>
      invoke("sources:update", id, options),
    remove: (id: string) => invoke("sources:remove", id),
    check: (id: string) => invoke("sources:check", id),
  },
  manga: {
    bookmarks: () => invoke("manga:bookmarks"),
    bookmark: (kind: string, source: string, id: string, saved: boolean) =>
      invoke("manga:bookmark", kind, source, id, saved),
    book: (p: string, id: string, title?: string) =>
      invoke("manga:book", p, id, title),
    resolve: (p: string, selection: unknown) =>
      invoke("manga:resolve", p, selection),
    info: (p: string, id: string) => invoke("manga:info", p, id),
    details: (id: number) => invoke("manga:details", id),
    discover: (filters: unknown) => invoke("manga:discover", filters),
    catalogueCover: (id: number) => invoke("manga:catalogue-cover", id),
    sources: () => invoke("manga:sources"),
    recent: (p: string) => invoke("manga:recent", p),
    search: (p: string, q: string) => invoke("manga:search", p, q),
    chapters: (p: string, b: string) => invoke("manga:chapters", p, b),
    pages: (p: string, b: string, c: string) => invoke("manga:pages", p, b, c),
    image: (h: string) => invoke("manga:image", h),
    cover: (p: string, b: string, refresh: boolean) =>
      invoke("manga:cover", p, b, refresh),
    progress: (p: string, b: string) => invoke("manga:progress", p, b),
    save: (p: string, b: string, c: string, n: number) =>
      invoke("manga:save", p, b, c, n),
  },
  window: {
    minimize: () => invoke("window:minimize"),
    toggleMaximize: () => invoke("window:toggle-maximize"),
    close: () => invoke("window:close"),
    setFullscreen: (value: boolean): Promise<unknown> =>
      invoke("window:set-fullscreen", value),
    isFullscreen: (): Promise<unknown> => invoke("window:is-fullscreen"),
  },

  app: {
    getVersion: (): Promise<unknown> => invoke("app:version"),
    getDataDir: (): Promise<unknown> => invoke("app:data-dir"),
    /** Aggregate status: providers, adapters, extensions, counts. */
    diagnostics: (): Promise<unknown> => invoke("diagnostics:report"),
  },

  shell: {
    openExternal: (url: string): Promise<unknown> =>
      invoke("shell:open-external", url),
  },

  settings: {
    get: (): Promise<unknown> => invoke("settings:get"),
    save: (settings: unknown): Promise<unknown> =>
      invoke("settings:save", settings),
  },

  media: {
    streamQualities: (locator: string) => invoke("playback:qualities", locator),
    search: (query: unknown): Promise<unknown> => invoke("search:run", query),
    trending: (kind: unknown): Promise<unknown> =>
      invoke("media:trending", kind),
    details: (item: unknown): Promise<unknown> => invoke("media:details", item),
    resolvePlayback: (item: unknown, source?: string): Promise<unknown> =>
      invoke("playback:resolve", item, source),
    probe: (fileId: string): Promise<unknown> => invoke("media:probe", fileId),
    probeAvailable: (): Promise<unknown> => invoke("media:probe-available"),
    skipTimes: (request: unknown): Promise<unknown> =>
      invoke("media:skip-times", request),
    reportSkip: (skipId: string): Promise<unknown> =>
      invoke("media:report-skip", skipId),
  },

  /**
   * The mpv playback engine.
   *
   * `onState` is the one push channel in the bridge: mpv reports position
   * several times a second, and polling that over `invoke` would be a round
   * trip per frame. The listener is wrapped so the renderer never receives
   * Electron's event object, only the payload.
   */
  mpv: {
    status: (): Promise<unknown> => invoke("mpv:status"),
    subscribe: (): Promise<unknown> => invoke("mpv:subscribe"),
    open: (request: unknown): Promise<unknown> => invoke("mpv:open", request),
    setRect: (rect: unknown): Promise<unknown> => invoke("mpv:set-rect", rect),
    play: (): Promise<unknown> => invoke("mpv:play"),
    pause: (): Promise<unknown> => invoke("mpv:pause"),
    seek: (seconds: number): Promise<unknown> => invoke("mpv:seek", seconds),
    seekBy: (delta: number): Promise<unknown> => invoke("mpv:seek-by", delta),
    setVolume: (volume: number): Promise<unknown> =>
      invoke("mpv:set-volume", volume),
    setMuted: (muted: boolean): Promise<unknown> =>
      invoke("mpv:set-muted", muted),
    setSpeed: (speed: number): Promise<unknown> =>
      invoke("mpv:set-speed", speed),
    setSubtitleDelay: (seconds: number): Promise<unknown> =>
      invoke("mpv:set-subtitle-delay", seconds),
    setSubtitleScale: (scale: number): Promise<unknown> =>
      invoke("mpv:set-subtitle-scale", scale),
    setSubtitleStyleOverride: (enabled: boolean): Promise<unknown> =>
      invoke("mpv:set-subtitle-style-override", enabled),
    setSurfaceVisible: (visible: boolean): Promise<unknown> =>
      invoke("mpv:set-surface-visible", visible),
    selectTrack: (selection: unknown): Promise<unknown> =>
      invoke("mpv:select-track", selection),
    setSubtitleVisible: (visible: boolean): Promise<unknown> =>
      invoke("mpv:set-subtitle-visible", visible),
    close: (): Promise<unknown> => invoke("mpv:close"),
    onState: (listener: (state: unknown) => void): (() => void) => {
      const wrapped = (_event: unknown, state: unknown) => listener(state);
      ipcRenderer.on("mpv:state", wrapped);
      return () => ipcRenderer.off("mpv:state", wrapped);
    },
  },

  /**
   * The link between the catalogue window and the controls window.
   *
   * The controls float in their own transparent window above mpv's video
   * surface, so anything they need that mpv does not report has to travel
   * through here.
   */
  player: {
    setNowPlaying: (value: unknown): Promise<unknown> =>
      invoke("player:set-now-playing", value),
    getNowPlaying: (): Promise<unknown> => invoke("player:get-now-playing"),
    send: (command: string): Promise<unknown> =>
      invoke("player:command", command),
    focus: (): Promise<unknown> => invoke("player:focus"),
    drag: (payload: unknown): Promise<unknown> =>
      invoke("player:drag", payload),
    toggleMaximize: (): Promise<unknown> => invoke("player:toggle-maximize"),
    setInteractive: (interactive: boolean): Promise<unknown> =>
      invoke("player:set-interactive", interactive),
    setQuality: (locator: string): Promise<unknown> =>
      invoke("player:set-quality", { locator }),
    onNowPlaying: (listener: (value: unknown) => void): (() => void) => {
      const wrapped = (_event: unknown, value: unknown) => listener(value);
      ipcRenderer.on("player:now-playing", wrapped);
      return () => ipcRenderer.off("player:now-playing", wrapped);
    },
    onCommand: (listener: (command: string) => void): (() => void) => {
      const wrapped = (_event: unknown, command: unknown) =>
        listener(String(command));
      ipcRenderer.on("player:command", wrapped);
      return () => ipcRenderer.off("player:command", wrapped);
    },
    onQuality: (listener: (locator: string) => void): (() => void) => {
      const wrapped = (_event: unknown, locator: unknown) =>
        listener(String(locator));
      ipcRenderer.on("player:quality", wrapped);
      return () => ipcRenderer.off("player:quality", wrapped);
    },
  },

  watchlist: {
    list: (): Promise<unknown> => invoke("watchlist:list"),
    add: (entry: unknown): Promise<unknown> => invoke("watchlist:add", entry),
    remove: (ref: unknown): Promise<unknown> => invoke("watchlist:remove", ref),
  },

  progress: {
    all: (): Promise<unknown> => invoke("progress:all"),
    save: (progress: unknown): Promise<unknown> =>
      invoke("progress:save", progress),
    clear: (ref: unknown): Promise<unknown> => invoke("progress:clear", ref),
  },

  bookmarks: {
    all: (): Promise<unknown> => invoke("bookmarks:all"),
    toggle: (input: unknown): Promise<unknown> =>
      invoke("bookmarks:toggle", input),
  },

  history: {
    list: (): Promise<unknown> => invoke("history:list"),
    add: (entry: unknown): Promise<unknown> => invoke("history:add", entry),
    clear: (): Promise<unknown> => invoke("history:clear"),
  },

  library: {
    files: (): Promise<unknown> => invoke("library:files"),
    entries: (): Promise<unknown> => invoke("library:entries"),
    folders: (): Promise<unknown> => invoke("library:folders"),
    pickFolder: (): Promise<unknown> => invoke("library:pick-folder"),
    removeFolder: (id: string): Promise<unknown> =>
      invoke("library:remove-folder", id),
    scan: (): Promise<unknown> => invoke("library:scan"),
    rematch: (): Promise<unknown> => invoke("library:rematch"),

    /** Fires when details are filled in behind the scenes. */
    onChanged: (listener: () => void): (() => void) => {
      const handler = (): void => listener();
      ipcRenderer.on("library:changed", handler);
      return () => ipcRenderer.removeListener("library:changed", handler);
    },
  },

  extensions: {
    setEnabled: (id: string, enabled: boolean) =>
      invoke("extensions:enabled", id, enabled),
    list: (): Promise<unknown> => invoke("extensions:list"),
    call: (
      extensionId: string,
      method: string,
      args: unknown[],
    ): Promise<unknown> => invoke("extensions:call", extensionId, method, args),

    installed: (): Promise<unknown> => invoke("extensions:installed"),
    registries: (): Promise<unknown> => invoke("extensions:registries"),
    setRegistries: (urls: unknown): Promise<unknown> =>
      invoke("extensions:set-registries", urls),
    browse: (): Promise<unknown> => invoke("extensions:browse"),
    prepare: (candidate: unknown): Promise<unknown> =>
      invoke("extensions:prepare", candidate),
    install: (request: unknown): Promise<unknown> =>
      invoke("extensions:install", request),
    uninstall: (id: string): Promise<unknown> =>
      invoke("extensions:uninstall", id),
    pickUnpacked: (): Promise<unknown> => invoke("extensions:pick-unpacked"),
    installUnpacked: (request: unknown): Promise<unknown> =>
      invoke("extensions:install-unpacked", request),
  },

  platform: process.platform,
} as const;

export type VestraBridge = typeof api;

contextBridge.exposeInMainWorld("vestra", api);
