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

import {
  callExtension,
  listLoadedExtensions,
  loadInstalledExtensions,
  stopExtensionWorker,
} from "./extensions";
import { registerDataIpc } from "./ipc";
import {
  attachExtensionProvider,
  attachStreamSourceProvider,
} from "./extension-providers";
import { backfillMediaInfo, pruneThumbnails } from "./media-info";
import { registerMpvIpc, shutdownMpv } from "./mpv/ipc";
import {
  registerMediaProtocolHandler,
  registerMediaProtocolScheme,
} from "./media-protocol";
import { getDriver, resolveDataDir } from "./services";
import { stopCSharpProviders } from "./csharp-providers";
import { registerSourceIpc } from "./source-ipc";
import { registerMangaIpc } from "./manga-ipc";
import { registerAnimeIpc } from "./anime-ipc";

/**
 * Vestra Nova — Electron main process.
 *
 * Security posture:
 *  - contextIsolation ON, nodeIntegration OFF, sandbox ON
 *  - the renderer talks to the main process only through the allow-listed
 *    preload bridge
 *  - external links open in the system browser, never in an app window
 *  - navigation away from the bundled shell is blocked
 *
 * There is no renderer application yet. The previous UI was a Next.js app that
 * Nova spawned on loopback; it has been removed, and `shell.html` stands in
 * until a replacement exists. Everything below it — IPC, the extension worker,
 * the data directory — is unaffected and already running.
 */

const isDev = process.env.NODE_ENV === "development";

/**
 * Pin the app name before anything reads a path from it.
 *
 * Unset, Electron derives `userData` from package.json `name`, giving
 * `AppData/Roaming/@vestra/nova`. A packaged build uses electron-builder's
 * `productName` instead — so development and production would quietly keep
 * their library, watchlist and settings in two different places.
 */
app.setName("Vestra Nova");

/**
 * Turn off DirectComposition so mpv's video is visible.
 *
 * Chromium composites the window through a DirectComposition visual that sits
 * above every child window. mpv renders into a child window of its own, so its
 * output was being drawn correctly and then covered — the player showed a
 * black rectangle while reporting perfectly healthy playback state.
 *
 * Verified: with DirectComposition on, the video region samples pure #000000;
 * with it off, the same region shows the decoded frame and its subtitles. The
 * cost is Chromium's own compositing path, which matters little here because
 * video is mpv's job, not Chromium's.
 */
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-direct-composition");
}

/**
 * Remote debugging, for development only.
 *
 * Opens a DevTools Protocol endpoint on loopback so the renderer can be
 * inspected and driven from outside the app — reading the DOM, console errors
 * and computed styles without a human watching the window.
 *
 * Gated twice, deliberately. The endpoint is an unauthenticated channel that
 * can execute arbitrary script in the renderer and read anything it can reach,
 * so it must never exist in a packaged build: `app.isPackaged` refuses that
 * outright, and an explicit environment variable is required on top, so it
 * cannot appear by accident during ordinary development either.
 */
const debugPort = Number.parseInt(process.env.VESTRA_DEBUG_PORT ?? "", 10);

if (!app.isPackaged && Number.isInteger(debugPort) && debugPort > 0) {
  app.commandLine.appendSwitch("remote-debugging-port", String(debugPort));
  // Bind to loopback explicitly rather than trusting the default.
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  console.warn(
    `[nova] DevTools Protocol listening on 127.0.0.1:${debugPort}. ` +
      "Development only — this endpoint is unauthenticated.",
  );
} else if (app.isPackaged && process.env.VESTRA_DEBUG_PORT) {
  console.warn(
    "[nova] VESTRA_DEBUG_PORT ignored: refused in a packaged build.",
  );
}

// Privileged schemes must be declared before the app is ready.
registerMediaProtocolScheme();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

/**
 * Where the application icon lives at runtime.
 *
 * electron-builder embeds it into the executable for the taskbar and installer,
 * but the tray needs a real file it can load, so a copy is shipped alongside.
 */
function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "icon.png")
    : join(app.getAppPath(), "build", "icon.png");
}

/**
 * Where the renderer comes from.
 *
 * Development uses the Vite dev server so edits hot-reload; production loads
 * the built files from disk. Nothing is served in production — there is no
 * HTTP server in Nova any more.
 */
const DEV_SERVER_URL = "http://localhost:5273";

function loadRenderer(window: BrowserWindow): void {
  if (isDev) {
    void window.loadURL(DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  void window.loadFile(join(__dirname, "../dist-renderer/index.html"));
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    icon: appIconPath(),
    // Fully frameless. The renderer draws its own traffic lights, so the native
    // overlay is off — leaving it on would put a second set of controls in the
    // top right.
    titleBarStyle: "hidden",
    ...(process.platform === "linux" ? { frame: false } : {}),
    backgroundColor: "#0d0d10",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      /**
       * Keep running while covered.
       *
       * During playback this window is entirely hidden behind the video
       * surface and the controls above it. Chromium treats a fully occluded
       * window as not worth servicing and throttles its timers and animation
       * frames — which stalled the periodic progress save, and left the video
       * at its old size after a fullscreen change because the callback that
       * reports the new one never ran.
       */
      backgroundThrottling: false,
    },
  });

  // Avoid a white flash before the first paint.
  /**
   * Open maximised.
   *
   * Maximised before being shown, rather than after: doing it afterwards makes
   * the window appear at its default size and then jump, which is visible on
   * every launch. The width and height above remain the size it returns to
   * when unmaximised.
   */
  window.once("ready-to-show", () => {
    window.maximize();
    window.show();
  });

  // Surface renderer logs in the terminal. Without this the renderer's console
  // is only visible in devtools, which makes a headless run impossible to
  // diagnose — and a packaged Nova has no devtools at all.
  window.webContents.on("console-message", (details) => {
    const prefix = `[renderer:${details.level}]`;
    if (details.level === "error") console.error(prefix, details.message);
    else console.info(prefix, details.message);
  });

  // Open target=_blank and external links in the user's browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Block in-app navigation. The renderer is a single-page app using hash
  // routing, so any real navigation attempt is either a mistake or hostile.
  window.webContents.on("will-navigate", (event, url) => {
    if (isDev && url.startsWith(DEV_SERVER_URL)) return;

    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
  });

  void loadRenderer(window);

  window.on("closed", () => {
    mainWindow = null;
  });

  return window;
}

function createTray(): void {
  // Scaled down here rather than shipping a second asset: the source is a
  // 1024px icon, and handing that to the tray leaves Windows to resize it with
  // a cheaper filter.
  const icon = nativeImage
    .createFromPath(appIconPath())
    .resize({ width: 16, height: 16, quality: "best" });

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
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

  /**
   * Native fullscreen, rather than the renderer's own.
   *
   * `requestFullscreen` in the page only resizes the web view. mpv draws into
   * a separate native window positioned from the real window's bounds, so a
   * page-level fullscreen left the video at its windowed size and position.
   * Driving the window itself keeps the two in step.
   */
  ipcMain.handle("window:set-fullscreen", (_event, value: unknown) => {
    if (!mainWindow) return false;
    mainWindow.setFullScreen(value === true);
    return mainWindow.isFullScreen();
  });

  ipcMain.handle(
    "window:is-fullscreen",
    () => mainWindow?.isFullScreen() ?? false,
  );

  ipcMain.handle("app:version", () => app.getVersion());

  // Settings, discovery, watchlist, progress, library and extensions.
  registerDataIpc();

  // Playback through mpv. Separate because these channels need the calling
  // window — mpv draws into a native surface owned by it.
  registerMpvIpc();
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

  void app.whenReady().then(() => {
    registerIpc();
    registerMediaProtocolHandler();
    registerMangaIpc();
    registerAnimeIpc();
    registerSourceIpc();

    mainWindow = createWindow();
    createTray();
    initAutoUpdate();

    /*
      Fill in runtimes and stills for anything indexed without them.

      Started here rather than during a scan: it opens every file, which takes
      far longer than indexing does, and the library is perfectly usable while
      it runs. Nothing waits on it, and a failure leaves the fields null —
      which is what they already were.

      The renderer is told at most once a second. It refetches the whole index
      each time, and a library of several hundred files would otherwise ask it
      to do so several hundred times in a row.
    */
    let announced = 0;

    void backfillMediaInfo(getDriver(), (done, total) => {
      const now = Date.now();
      if (done < total && now - announced < 1000) return;

      announced = now;
      mainWindow?.webContents.send("library:changed");
    })
      .then((filled) => {
        if (filled > 0) console.info(`[nova] filled in ${filled} file(s)`);
        return pruneThumbnails(getDriver());
      })
      .catch((error: unknown) => {
        console.warn("[nova] could not read media details", error);
      });

    // Extensions are not required for the app to work, so a failure here is
    // reported and moved past rather than blocking startup.
    void loadInstalledExtensions(resolveDataDir()).then(
      (report) => {
        for (const skipped of report.skipped) {
          console.warn(
            `[nova] skipped extension ${skipped.id}: ${skipped.reason}`,
          );
        }
        if (report.loaded.length > 0) {
          console.info(`[nova] loaded ${report.loaded.length} extension(s)`);
        }

        // Anything that searches becomes a provider, so its results appear
        // alongside the built-in ones rather than nowhere. Stream sources go
        // to their own registry; each call ignores records that are not its
        // role, so both run over the same list.
        for (const record of report.records) {
          attachExtensionProvider(record, report.methods[record.id] ?? []);
          attachStreamSourceProvider(record, report.methods[record.id] ?? []);
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

  // Killing the worker disposes every isolate with it.
  app.on("will-quit", stopExtensionWorker);
  app.on("will-quit", stopCSharpProviders);

  // mpv is a child process holding a window handle; leaving it running would
  // orphan a decoder with no interface attached to it.
  app.on("will-quit", shutdownMpv);

  app.on("window-all-closed", () => {
    // macOS apps conventionally stay running with no windows open.
    if (process.platform !== "darwin") app.quit();
  });
}
