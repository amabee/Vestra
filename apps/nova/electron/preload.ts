import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload bridge.
 *
 * Context isolation is on, so the renderer gets exactly this object and nothing
 * else — no `require`, no Node globals, no arbitrary IPC. Every method maps to a
 * channel explicitly registered in the main process.
 */

const api = {
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
  },
  app: {
    getVersion: (): Promise<string> => ipcRenderer.invoke("app:version"),
    getDataDir: (): Promise<string> => ipcRenderer.invoke("app:data-dir"),
  },
  platform: process.platform,
} as const;

export type VestraBridge = typeof api;

contextBridge.exposeInMainWorld("vestra", api);
