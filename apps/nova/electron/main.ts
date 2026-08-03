import { join } from "node:path";

import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} from "electron";

import { startAppServer, stopAppServer } from "./app-server";
import {
  callExtension,
  listLoadedExtensions,
  loadInstalledExtensions,
  stopExtensionWorker,
} from "./extensions";

/**
 * Vestra Nova — Electron main process.
 *
 * Security posture:
 *  - contextIsolation ON, nodeIntegration OFF, sandbox ON
 *  - the renderer talks to the main process only through the allow-listed
 *    preload bridge
 *  - external links open in the system browser, never in an app window
 *  - navigation away from the app origin is blocked
 */

const isDev = process.env.NODE_ENV === "development";

/**
 * Resolved once the app server is listening.
 *
 * In development that is the Next dev server; in production it is the
 * standalone build Nova starts itself on a free loopback port.
 */
let appUrl = "http://localhost:3000";

/**
 * Where Vestra persists watchlist, progress, settings and the library index.
 *
 * The OS app-data directory rather than the working directory, so a packaged
 * Nova writes somewhere durable and writable. Passed to the app server as
 * `VESTRA_DATA_DIR` and exposed to the renderer over IPC.
 */
function resolveDataDir(): string {
  return join(app.getPath("userData"), "data");
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    // Frameless with a custom draggable bar rendered by the app (.drag-region).
    titleBarStyle: "hidden",
    ...(process.platform === "linux" ? { frame: false } : {}),
    titleBarOverlay: {
      color: "#131316",
      symbolColor: "#f4f4f5",
      height: 64,
    },
    backgroundColor: "#0d0d10",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // Avoid a white flash before the first paint.
  window.once("ready-to-show", () => window.show());

  // Open target=_blank and external links in the user's browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Block in-app navigation to any other origin.
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== new URL(appUrl).origin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void window.loadURL(appUrl);

  window.on("closed", () => {
    mainWindow = null;
  });

  return window;
}

function createTray(): void {
  // An empty image keeps the tray functional before branding assets exist.
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip("Vestra Nova");

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Open Vestra",
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
        },
      },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );

  tray.on("click", () => {
    if (mainWindow?.isVisible()) mainWindow.hide();
    else mainWindow?.show();
  });
}

/* -----------------------------------------------------------------------------
 * IPC — every channel is explicitly registered; the preload exposes no others.
 * -------------------------------------------------------------------------- */

function registerIpc(): void {
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());

  ipcMain.handle("window:toggle-maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });

  ipcMain.handle("window:close", () => mainWindow?.close());

  ipcMain.handle("app:version", () => app.getVersion());

  ipcMain.handle("app:data-dir", () => resolveDataDir());

  ipcMain.handle("extensions:list", () => listLoadedExtensions());

  // Arguments are validated as plain data before crossing into the worker; the
  // isolate rejects anything it cannot JSON round-trip anyway.
  ipcMain.handle(
    "extensions:call",
    (_event, extensionId: unknown, method: unknown, args: unknown) => {
      if (typeof extensionId !== "string" || typeof method !== "string") {
        throw new Error("An extension id and method name are required.");
      }
      return callExtension(extensionId, method, Array.isArray(args) ? args : []);
    },
  );
}

/* -----------------------------------------------------------------------------
 * Auto-update — placeholder.
 * Wire electron-updater here once a release feed exists.
 * -------------------------------------------------------------------------- */

function initAutoUpdate(): void {
  if (isDev) return;
  // TODO: import { autoUpdater } from "electron-updater" and call
  // autoUpdater.checkForUpdatesAndNotify() once releases are published.
}

// A single instance owns the tray and window; a second launch focuses the first.
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(async () => {
    registerIpc();

    try {
      // The app server owns the routes, provider registry, scanner and matcher,
      // so it must be listening before the window loads anything.
      const server = await startAppServer({ isDev, dataDir: resolveDataDir() });
      appUrl = server.url;
    } catch (error) {
      dialog.showErrorBox(
        "Vestra could not start",
        error instanceof Error ? error.message : "The app server failed to start.",
      );
      app.quit();
      return;
    }

    mainWindow = createWindow();
    createTray();
    initAutoUpdate();

    // Extensions are not required for the app to work, so a failure here is
    // reported and moved past rather than blocking startup.
    void loadInstalledExtensions(resolveDataDir()).then(
      (report) => {
        for (const skipped of report.skipped) {
          console.warn(`[nova] skipped extension ${skipped.id}: ${skipped.reason}`);
        }
        if (report.loaded.length > 0) {
          console.info(`[nova] loaded ${report.loaded.length} extension(s)`);
        }
      },
      (error: unknown) => {
        console.error("[nova] could not start the extension worker", error);
      },
    );

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
      }
    });
  });

  // Never leave an orphaned server process behind.
  app.on("will-quit", () => {
    // Killing the worker disposes every isolate with it.
    stopExtensionWorker();
    stopAppServer();
  });

  app.on("window-all-closed", () => {
    // macOS apps conventionally stay running with no windows open.
    if (process.platform !== "darwin") app.quit();
  });
}
