import { app, BrowserWindow, dialog } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { handleIpc, secureWindow } from "./ipc-security";
import { StartupGate } from "./startup-gate";

export function createStartupWindow(options: {
  icon: string;
  rendererRoot: string;
  main: () => BrowserWindow | null;
  devUrl?: string;
}) {
  const file = join(options.rendererRoot, "splash.html");
  const url = options.devUrl
    ? `${options.devUrl}/splash.html`
    : pathToFileURL(file).href;
  const splash = new BrowserWindow({
    width: 800,
    height: 540,
    useContentSize: true,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "Starting Vestra Nova",
    icon: options.icon,
    backgroundColor: "#f6f2e7",
    webPreferences: {
      preload: join(__dirname, "preload-splash.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  secureWindow(splash, "splash", url);
  const gate = new StartupGate(
    app.getVersion(),
    (state) => {
      if (!splash.isDestroyed())
        splash.webContents.send("startup:changed", state);
    },
    () => {
      const main = options.main();
      if (!main || main.isDestroyed()) return;
      main.maximize();
      main.show();
      main.focus();
      splash.destroy();
    },
  );
  handleIpc("startup:state", () => gate.snapshot());
  handleIpc("startup:continue", () => gate.continue());
  handleIpc("startup:quit", () => app.quit());
  handleIpc("startup:retry", () => {
    app.relaunch();
    app.quit();
  });
  handleIpc("startup:renderer-ready", (event, warnings: unknown) => {
    if (event.sender !== options.main()?.webContents)
      throw Error("Only the app can confirm readiness.");
    if (
      !Number.isInteger(warnings) ||
      (warnings as number) < 0 ||
      (warnings as number) > 6
    )
      throw Error("Invalid startup result.");
    gate.rendererReady(warnings as number);
  });
  const shown = new Promise<void>((resolve, reject) => {
    splash.once("ready-to-show", () => {
      splash.show();
      resolve();
    });
    void (options.devUrl ? splash.loadURL(url) : splash.loadFile(file)).catch(
      (error) => {
        gate.dispose();
        dialog.showErrorBox(
          "Vestra couldn't start",
          "The startup screen couldn't load. Restart Nova, or reinstall the latest build.",
        );
        app.quit();
        reject(error);
      },
    );
  });
  splash.on("close", () => {
    if (!gate.snapshot().opened) app.quit();
  });
  app.once("will-quit", () => gate.dispose());
  return {
    gate,
    shown,
    focus: () => {
      if (!splash.isDestroyed()) {
        splash.show();
        splash.focus();
      }
    },
  };
}
