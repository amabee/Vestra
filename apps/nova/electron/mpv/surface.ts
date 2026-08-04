import { BrowserWindow } from "electron";

/**
 * The window mpv draws into.
 *
 * mpv fills the handle it is given, so it cannot be handed the main window —
 * it would paint over the whole interface. Instead it gets a small child
 * window kept positioned over the player's video region.
 *
 * The renderer reports that region in CSS pixels, which match Electron's
 * device-independent pixels at the default zoom, so they can be added to the
 * main window's content origin without scaling.
 */

export interface SurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class MpvSurface {
  #window: BrowserWindow | null = null;
  #parent: BrowserWindow | null = null;
  #rect: SurfaceRect | null = null;
  #detach: (() => void) | null = null;
  /** Set while a dialog needs the space; suppresses re-showing on reposition. */
  #hidden = false;

  /** The window handle mpv should render into, creating it on first use. */
  acquire(parent: BrowserWindow): BrowserWindow {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;

    const surface = new BrowserWindow({
      parent,
      show: false,
      frame: false,
      // Frameless windows still get WS_THICKFRAME on Windows, which draws a
      // resize border — a visible hairline around the video. Removing it also
      // drops the shadow and open animation, none of which a video surface
      // should have.
      thickFrame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: "#000000",
      // Nothing is loaded into this window; it exists purely as a native
      // surface for mpv, so the web stack stays locked down.
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        javascript: false,
      },
    });

    // The surface must never take focus: clicks belong to the interface, and a
    // focused child window would break keyboard shortcuts.
    surface.setFocusable(false);
    surface.setMenuBarVisibility(false);

    this.#window = surface;
    this.#parent = parent;

    const reposition = () => this.#apply();
    parent.on("move", reposition);
    parent.on("resize", reposition);
    parent.on("restore", reposition);

    /**
     * Fullscreen changes the content origin and size in one step, and the
     * renderer's own measurement arrives a frame or two later. Re-applying on
     * both the transition and a short delay afterwards keeps the surface from
     * being left at its windowed geometry, which showed as a video stuck in
     * the top-left of a fullscreen window.
     */
    const afterTransition = () => {
      this.#apply();
      setTimeout(reposition, 60);
      setTimeout(reposition, 250);
    };

    parent.on("enter-full-screen", afterTransition);
    parent.on("leave-full-screen", afterTransition);
    parent.on("maximize", afterTransition);
    parent.on("unmaximize", afterTransition);

    this.#detach = () => {
      parent.off("move", reposition);
      parent.off("resize", reposition);
      parent.off("restore", reposition);
      parent.off("enter-full-screen", afterTransition);
      parent.off("leave-full-screen", afterTransition);
      parent.off("maximize", afterTransition);
      parent.off("unmaximize", afterTransition);
    };

    // A parent that goes away takes the surface with it.
    parent.once("closed", () => this.destroy());

    return surface;
  }

  /** Place the surface over a region of the parent's content area. */
  setRect(rect: SurfaceRect): void {
    this.#rect = rect;
    this.#apply();
  }

  /**
   * Show or hide without forgetting where the surface belongs.
   *
   * Used when a dialog needs to appear over the video: the surface is a native
   * window and cannot be drawn on top of, so it steps aside and comes back to
   * the same place afterwards.
   */
  setVisible(visible: boolean): void {
    this.#hidden = !visible;

    if (!visible) {
      this.hide();
      return;
    }

    this.#apply();
  }

  #apply(): void {
    const surface = this.#window;
    const parent = this.#parent;
    const rect = this.#rect;

    if (!surface || surface.isDestroyed() || !parent || parent.isDestroyed() || !rect) {
      return;
    }

    // Deliberately hidden: keep the bounds current so it reappears in place,
    // but do not put it back on screen.
    if (this.#hidden) return;

    const content = parent.getContentBounds();

    // A zero or negative size is rejected by setBounds; hide instead, which is
    // what a collapsed region means anyway.
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (width < 1 || height < 1) {
      if (surface.isVisible()) surface.hide();
      return;
    }

    surface.setBounds({
      x: Math.round(content.x + rect.x),
      y: Math.round(content.y + rect.y),
      width,
      height,
    });

    if (!surface.isVisible()) surface.showInactive();
  }

  hide(): void {
    if (this.#window && !this.#window.isDestroyed()) this.#window.hide();
  }

  destroy(): void {
    this.#detach?.();
    this.#detach = null;

    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy();

    this.#window = null;
    this.#parent = null;
    this.#rect = null;
    this.#hidden = false;
  }
}
