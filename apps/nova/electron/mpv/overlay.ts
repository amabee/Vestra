import { BrowserWindow } from "electron";
import { join } from "node:path";

import type { SurfaceRect } from "./surface";

/**
 * The transparent window that holds the player's controls.
 *
 * mpv renders into a native window, which Windows composites above anything
 * the page draws — so controls placed in the main window are simply painted
 * over. A separate transparent window stacked above the video surface is the
 * only way to float them, and it is how the video area ends up behaving like
 * a normal player: controls over the picture, fading in and out, with nothing
 * being resized underneath them.
 *
 * Verified to work with `disable-direct-composition`, which the video surface
 * requires. That combination was the open question this design rested on.
 */

const DEV_SERVER = "http://127.0.0.1:5273/overlay.html";

export class MpvOverlay {
  #window: BrowserWindow | null = null;
  #parent: BrowserWindow | null = null;
  #rect: SurfaceRect | null = null;
  #hidden = true;

  /** Create (or return) the overlay stacked above the given video surface. */
  acquire(parent: BrowserWindow, surface: BrowserWindow, isDev: boolean): BrowserWindow {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;

    const overlay = new BrowserWindow({
      // Parented to the surface so the compositor keeps it above the video
      // without any manual z-order juggling.
      parent: surface,
      show: false,
      frame: false,
      thickFrame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    // Never take focus: keyboard shortcuts belong to the main window, and an
    // activated overlay would steal them. Clicks still land on the controls.
    overlay.setFocusable(false);
    overlay.setMenuBarVisibility(false);

    void (isDev
      ? overlay.loadURL(DEV_SERVER)
      : overlay.loadFile(join(__dirname, "../dist-renderer/overlay.html")));

    this.#window = overlay;
    this.#parent = parent;

    const reposition = () => this.#apply();
    parent.on("move", reposition);
    parent.on("resize", reposition);
    parent.on("restore", reposition);

    const afterTransition = () => {
      this.#apply();
      setTimeout(reposition, 60);
      setTimeout(reposition, 250);
    };

    parent.on("enter-full-screen", afterTransition);
    parent.on("leave-full-screen", afterTransition);
    parent.on("maximize", afterTransition);
    parent.on("unmaximize", afterTransition);

    parent.once("closed", () => this.destroy());

    return overlay;
  }

  get webContents(): Electron.WebContents | null {
    if (!this.#window || this.#window.isDestroyed()) return null;
    return this.#window.webContents;
  }

  setRect(rect: SurfaceRect): void {
    this.#rect = rect;
    this.#apply();
  }

  setVisible(visible: boolean): void {
    this.#hidden = !visible;

    if (!visible) {
      if (this.#window && !this.#window.isDestroyed()) this.#window.hide();
      return;
    }

    this.#apply();
  }

  #apply(): void {
    const overlay = this.#window;
    const parent = this.#parent;
    const rect = this.#rect;

    if (!overlay || overlay.isDestroyed() || !parent || parent.isDestroyed() || !rect) {
      return;
    }

    if (this.#hidden) return;

    const content = parent.getContentBounds();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (width < 1 || height < 1) {
      if (overlay.isVisible()) overlay.hide();
      return;
    }

    overlay.setBounds({
      x: Math.round(content.x + rect.x),
      y: Math.round(content.y + rect.y),
      width,
      height,
    });

    if (!overlay.isVisible()) overlay.showInactive();
  }

  destroy(): void {
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy();
    this.#window = null;
    this.#parent = null;
    this.#rect = null;
    this.#hidden = true;
  }
}
