import { contextBridge, ipcRenderer } from "electron";

// The splash can only read startup progress and control this launch.
if (process.isMainFrame)
  contextBridge.exposeInMainWorld("novaStartup", {
    state: () => ipcRenderer.invoke("startup:state"),
    continue: () => ipcRenderer.invoke("startup:continue"),
    retry: () => ipcRenderer.invoke("startup:retry"),
    quit: () => ipcRenderer.invoke("startup:quit"),
    onChanged: (listener: (value: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) =>
        listener(value);
      ipcRenderer.on("startup:changed", handler);
      return () => ipcRenderer.removeListener("startup:changed", handler);
    },
  });
