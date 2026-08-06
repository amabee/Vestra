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
    openExternal: (url: string): Promise<unknown> => invoke("shell:open-external", url),
  },

  settings: {
    get: (): Promise<unknown> => invoke("settings:get"),
    save: (settings: unknown): Promise<unknown> => invoke("settings:save", settings),
  },

  media: {
    search: (query: unknown): Promise<unknown> => invoke("search:run", query),
    trending: (kind: unknown): Promise<unknown> => invoke("media:trending", kind),
    details: (item: unknown): Promise<unknown> => invoke("media:details", item),
    resolvePlayback: (item: unknown): Promise<unknown> => invoke("playback:resolve", item),
    probe: (fileId: string): Promise<unknown> => invoke("media:probe", fileId),
    probeAvailable: (): Promise<unknown> => invoke("media:probe-available"),
    skipTimes: (request: unknown): Promise<unknown> => invoke("media:skip-times", request),
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
    setVolume: (volume: number): Promise<unknown> => invoke("mpv:set-volume", volume),
    setMuted: (muted: boolean): Promise<unknown> => invoke("mpv:set-muted", muted),
    setSpeed: (speed: number): Promise<unknown> => invoke("mpv:set-speed", speed),
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
    send: (command: string): Promise<unknown> => invoke("player:command", command),
    setInteractive: (interactive: boolean): Promise<unknown> =>
      invoke("player:set-interactive", interactive),
    onNowPlaying: (listener: (value: unknown) => void): (() => void) => {
      const wrapped = (_event: unknown, value: unknown) => listener(value);
      ipcRenderer.on("player:now-playing", wrapped);
      return () => ipcRenderer.off("player:now-playing", wrapped);
    },
    onCommand: (listener: (command: string) => void): (() => void) => {
      const wrapped = (_event: unknown, command: unknown) => listener(String(command));
      ipcRenderer.on("player:command", wrapped);
      return () => ipcRenderer.off("player:command", wrapped);
    },
  },

  watchlist: {
    list: (): Promise<unknown> => invoke("watchlist:list"),
    add: (entry: unknown): Promise<unknown> => invoke("watchlist:add", entry),
    remove: (ref: unknown): Promise<unknown> => invoke("watchlist:remove", ref),
  },

  progress: {
    all: (): Promise<unknown> => invoke("progress:all"),
    save: (progress: unknown): Promise<unknown> => invoke("progress:save", progress),
    clear: (ref: unknown): Promise<unknown> => invoke("progress:clear", ref),
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
    removeFolder: (id: string): Promise<unknown> => invoke("library:remove-folder", id),
    scan: (): Promise<unknown> => invoke("library:scan"),
  },

  extensions: {
    list: (): Promise<unknown> => invoke("extensions:list"),
    call: (extensionId: string, method: string, args: unknown[]): Promise<unknown> =>
      invoke("extensions:call", extensionId, method, args),
  },

  platform: process.platform,
} as const;

export type VestraBridge = typeof api;

contextBridge.exposeInMainWorld("vestra", api);
