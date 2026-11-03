import { contextBridge } from "electron";
import { api } from "./preload-api";
export type { VestraBridge } from "./preload-api";
if (process.isMainFrame) contextBridge.exposeInMainWorld("vestra", api);
