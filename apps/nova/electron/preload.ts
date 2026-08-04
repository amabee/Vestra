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
