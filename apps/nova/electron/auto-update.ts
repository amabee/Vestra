import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { autoUpdater } from "electron-updater";
import { UpdateController } from "./update-controller";

export function initAutoUpdate(window: () => BrowserWindow | null): void {
  // Portable launches and source runs have no installed NSIS upgrade target.
  const enabled =
    app.isPackaged &&
    process.platform === "win32" &&
    !process.env.PORTABLE_EXECUTABLE_DIR;
  const controller = new UpdateController(
    enabled ? autoUpdater : null,
    app.getVersion(),
    (state) => {
      const target = window();
      if (target && !target.isDestroyed())
        target.webContents.send("updates:changed", state);
    },
  );
  const trusted = (event: IpcMainInvokeEvent) => {
    if (
      event.sender !== window()?.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw Error("Update controls are only available in the app window.");
  };
  ipcMain.handle("updates:state", (event) => {
    trusted(event);
    return controller.snapshot();
  });
  ipcMain.handle("updates:check", (event) => {
    trusted(event);
    return controller.check();
  });
  ipcMain.handle("updates:download", (event) => {
    trusted(event);
    return controller.download();
  });
  ipcMain.handle("updates:install", (event) => {
    trusted(event);
    return controller.install();
  });
  app.once("will-quit", () => controller.dispose());
  controller.start();
}
