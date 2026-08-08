import { BrowserWindow, ipcMain } from "electron";
import { getLocalFiles, getSettings } from "@vestra/storage";
import { z } from "zod";

import { getDriver } from "../services";
import { MpvOverlay } from "./overlay";
import { MpvSession, locateMpv, type MpvState } from "./session";
import { MpvSurface } from "./surface";

/**
 * Playback channels for the mpv engine.
 *
 * Registered apart from the data channels because these need the window that
 * made the call: mpv renders into a native surface owned by that window, so
 * the handlers cannot be window-agnostic the way the data ones are.
 *
 * As with the media protocol, the renderer names a file id and never a path.
 * The library index is the allow-list, so this cannot be talked into opening
 * an arbitrary file on disk.
 */

const session = new MpvSession();
const surface = new MpvSurface();
const overlay = new MpvOverlay();

/**
 * What the overlay window needs that mpv cannot tell it.
 *
 * Playback state comes straight from mpv, but the title, the episode and the
 * position in the queue live in the catalogue window. This is the small record
 * that crosses between them.
 */
interface NowPlaying {
  title: string;
  episodeLabel: string | null;
  index: number;
  total: number;
  engine: "mpv" | "builtin";
  skips: { kind: "opening" | "ending"; startSeconds: number; endSeconds: number }[];
  autoSkip: boolean;
}

let nowPlaying: NowPlaying | null = null;

/** Renderers currently subscribed to state pushes. */
const subscribers = new Set<Electron.WebContents>();

session.onChange((state: MpvState) => {
  for (const contents of subscribers) {
    if (contents.isDestroyed()) {
      subscribers.delete(contents);
      continue;
    }
    contents.send("mpv:state", state);
  }

  overlay.webContents?.send("mpv:state", state);
});

const rectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(0),
  height: z.number().finite().min(0),
});

const openSchema = z.object({
  fileId: z.string().min(1).max(200),
  startSeconds: z.number().min(0).max(360_000).default(0),
  rect: rectSchema,
});

const trackSchema = z.object({
  type: z.enum(["audio", "sub", "video"]),
  id: z.number().int().nullable(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid ${what}: ${result.error.issues[0]?.message ?? "bad payload"}`);
  }
  return result.data;
}

function handle<TResult>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => Promise<TResult> | TResult,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    try {
      const result = await handler(event, ...args);
      return JSON.parse(JSON.stringify(result ?? null)) as TResult;
    } catch (error) {
      console.error(`[nova] ${channel} failed`, error);
      throw new Error(error instanceof Error ? error.message : `${channel} failed.`);
    }
  });
}

const isDev = (): boolean => process.env.NODE_ENV === "development";

/** Resolve a library file id to its path, refusing anything not indexed. */
async function pathForFileId(fileId: string): Promise<string> {
  const files = await getLocalFiles(getDriver());
  const file = files.find((entry) => entry.id === fileId);
  if (!file) throw new Error("That file is not in the library.");
  return file.path;
}

export function registerMpvIpc(): void {
  /** Whether mpv can be found, so the interface can say so before it is needed. */
  handle("mpv:status", async () => {
    const settings = await getSettings(getDriver());
    const path = locateMpv(settings.playback.mpvPath || null);
    return { available: path !== null, path, running: session.running };
  });

  handle("mpv:subscribe", (event) => {
    const contents = event.sender;

    // Subscribing happens on every mount of the player, always from the same
    // renderer. Registering the cleanup listener each time leaked one per
    // playback and tripped Node's max-listener warning after eleven.
    if (!subscribers.has(contents)) {
      subscribers.add(contents);
      contents.once("destroyed", () => subscribers.delete(contents));
    }

    return session.state;
  });

  handle("mpv:open", async (event, raw) => {
    const { fileId, startSeconds, rect } = parse(openSchema, raw, "open request");

    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("No window is associated with this request.");

    const filePath = await pathForFileId(fileId);
    const settings = await getSettings(getDriver());

    // Position the surface before mpv attaches, so the first frame lands in
    // the right place rather than flashing at the window origin.
    const target = surface.acquire(window);
    surface.setVisible(true);
    surface.setRect(rect);

    // The controls window sits on the same rectangle, one layer up.
    overlay.acquire(window, target, isDev());
    overlay.setVisible(true);
    overlay.setRect(rect);

    await session.start(target, {
      mpvPath: settings.playback.mpvPath || null,
      hardwareDecoding: settings.playback.hardwareDecoding,
      volume: settings.playback.defaultVolume,
    });

    await session.load(filePath, startSeconds);
    return session.state;
  });

  handle("mpv:set-rect", (_event, raw) => {
    const rect = parse(rectSchema, raw, "surface rect");
    surface.setRect(rect);
    overlay.setRect(rect);
    return null;
  });

  handle("mpv:play", () => session.play().then(() => null));
  handle("mpv:pause", () => session.pause().then(() => null));

  handle("mpv:seek", (_event, raw) => {
    const seconds = parse(z.number().min(0).max(360_000), raw, "seek position");
    return session.seek(seconds).then(() => null);
  });

  handle("mpv:seek-by", (_event, raw) => {
    const delta = parse(z.number().min(-3600).max(3600), raw, "seek offset");
    session.seekBy(delta);
    return null;
  });

  handle("mpv:set-volume", (_event, raw) => {
    const volume = parse(z.number().min(0).max(1), raw, "volume");
    return session.setVolume(volume).then(() => null);
  });

  handle("mpv:set-muted", (_event, raw) => {
    const muted = parse(z.boolean(), raw, "mute flag");
    return session.setMuted(muted).then(() => null);
  });

  handle("mpv:set-speed", (_event, raw) => {
    const speed = parse(z.number().min(0.25).max(4), raw, "speed");
    return session.setSpeed(speed).then(() => null);
  });

  handle("mpv:set-subtitle-delay", (_event, raw) => {
    const seconds = parse(z.number().min(-60).max(60), raw, "subtitle delay");
    return session.setSubtitleDelay(seconds).then(() => null);
  });

  handle("mpv:set-subtitle-scale", (_event, raw) => {
    const scale = parse(z.number().min(0.5).max(2.5), raw, "subtitle scale");
    return session.setSubtitleScale(scale).then(() => null);
  });

  handle("mpv:set-subtitle-style-override", (_event, raw) => {
    const enabled = parse(z.boolean(), raw, "style override");
    return session.setSubtitleStyleOverride(enabled).then(() => null);
  });

  /**
   * Show or hide the video surface.
   *
   * The surface is a native window drawn above the page, so a dialog opened
   * over the video would be painted over and never seen. Hiding it while a
   * dialog is open is what makes an overlay possible at all; playback is
   * untouched, so audio continues and position keeps advancing.
   */
  handle("mpv:set-surface-visible", (_event, raw) => {
    const visible = parse(z.boolean(), raw, "surface visibility");
    surface.setVisible(visible);
    return null;
  });

  handle("mpv:select-track", (_event, raw) => {
    const { type, id } = parse(trackSchema, raw, "track selection");
    return session.selectTrack(type, id).then(() => null);
  });

  handle("mpv:set-subtitle-visible", (_event, raw) => {
    const visible = parse(z.boolean(), raw, "subtitle visibility");
    return session.setSubtitleVisible(visible).then(() => null);
  });

  /**
   * Close playback.
   *
   * The surface is hidden rather than destroyed and mpv is left running: the
   * next episode then starts without paying for a process launch and a window
   * creation. `shutdownMpv` is what actually tears it down, at quit.
   */
  handle("mpv:close", async () => {
    overlay.setVisible(false);
    surface.setVisible(false);
    nowPlaying = null;
    if (session.running) await session.stop();
    return null;
  });

  /* --------------------------------------------------------------------- *
   * The bridge between the two windows
   * --------------------------------------------------------------------- */

  /** Published by the catalogue window; read by the controls window. */
  handle("player:set-now-playing", (_event, raw) => {
    nowPlaying = parse(nowPlayingSchema, raw, "now playing") as NowPlaying;
    overlay.webContents?.send("player:now-playing", nowPlaying);
    return null;
  });

  handle("player:get-now-playing", () => nowPlaying);

  /**
   * Actions the controls window cannot perform itself.
   *
   * Stepping between episodes and leaving the player need the queue, which
   * belongs to the catalogue window. The command is relayed there rather than
   * duplicating that state in two places.
   */
  handle("player:command", (_event, raw) => {
    const command = parse(commandSchema, raw, "player command");

    for (const contents of subscribers) {
      if (!contents.isDestroyed()) contents.send("player:command", command);
    }

    return null;
  });

  /**
   * Let the pointer through where the controls are not.
   *
   * The overlay spans the whole video, so without this it would swallow every
   * click. It reports which regions are interactive and the rest passes to
   * whatever is beneath.
   */
  /**
   * Give focus to the player.
   *
   * Called when the controls window is clicked while the application is in the
   * background. Focusing the window that was actually clicked is what Windows
   * will honour; asking the parent to take focus from a background process is
   * refused outright.
   */
  /**
   * Move the window by dragging the player's header.
   *
   * The usual `-webkit-app-region: drag` cannot be used here. The controls are
   * a window of their own stacked over the video, so dragging them would move
   * that window alone — and the main process immediately puts it back, since
   * its position is derived from the window beneath. The header reports
   * pointer movement instead and the window underneath is moved, which the
   * surface and controls then follow.
   */
  handle("player:drag", (_event, raw) => {
    const { phase, dx, dy } = parse(dragSchema, raw, "drag");

    const parent = overlay.parentWindow;
    if (!parent) return null;

    if (phase === "start") {
      // A maximised window cannot be moved; Windows restores it when its title
      // bar is dragged, so do the same.
      if (parent.isMaximized()) parent.unmaximize();
      return null;
    }

    if (parent.isMaximized() || parent.isFullScreen()) return null;

    // getPosition returns a plain array, so the elements are only optional as
    // far as the type system is concerned.
    const [x = 0, y = 0] = parent.getPosition();
    parent.setPosition(Math.round(x + dx), Math.round(y + dy));
    return null;
  });

  /** Maximise or restore, for a double-click on the player's header. */
  handle("player:toggle-maximize", () => {
    const parent = overlay.parentWindow;
    if (!parent) return null;
    if (parent.isMaximized()) parent.unmaximize();
    else parent.maximize();
    return null;
  });

  handle("player:focus", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) return null;
    if (window.isMinimized()) window.restore();
    window.focus();
    return null;
  });

  handle("player:set-interactive", (_event, raw) => {
    const interactive = parse(z.boolean(), raw, "interactive flag");
    const contents = overlay.webContents;
    if (!contents) return null;

    const window = BrowserWindow.fromWebContents(contents);
    window?.setIgnoreMouseEvents(!interactive, { forward: true });
    return null;
  });
}

const nowPlayingSchema = z.object({
  title: z.string().max(500),
  episodeLabel: z.string().max(200).nullable(),
  index: z.number().int().min(0),
  total: z.number().int().min(0),
  engine: z.enum(["mpv", "builtin"]),
  skips: z
    .array(
      z.object({
        kind: z.enum(["opening", "ending"]),
        startSeconds: z.number().min(0),
        endSeconds: z.number().min(0),
      }),
    )
    .default([]),
  autoSkip: z.boolean().default(false),
});

const commandSchema = z.enum([
  "next",
  "previous",
  "close",
  "toggle-fullscreen",
  "open-settings",
]);

const dragSchema = z.object({
  phase: z.enum(["start", "move"]),
  dx: z.number().finite().min(-10_000).max(10_000).default(0),
  dy: z.number().finite().min(-10_000).max(10_000).default(0),
});

/** Tear mpv down. Called on quit so no orphan process is left behind. */
export function shutdownMpv(): void {
  overlay.destroy();
  surface.destroy();
  session.dispose();
}
