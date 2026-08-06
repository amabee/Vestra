import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { app, type BrowserWindow } from "electron";

import { MpvConnection, type MpvEvent } from "./connection";

/**
 * An mpv process bound to a window.
 *
 * mpv draws into a native child window handed to it with `--wid`. That surface
 * is composited by the OS, above Chromium's output — which is why the player's
 * controls sit below the video rather than floating over it. Overlaid controls
 * would simply be painted over.
 */

/* =============================================================================
 * Locating mpv
 * ========================================================================== */

const WINDOWS_CANDIDATES = [
  "C:\\Program Files\\mpv\\mpv.exe",
  "C:\\Program Files\\mpv.net\\mpvnet.exe",
  "C:\\ProgramData\\chocolatey\\bin\\mpv.exe",
];

/**
 * Find an mpv executable.
 *
 * Order: an explicit setting, the copy bundled with the application, then
 * whatever is installed on the system. The bundled copy comes before PATH so
 * that behaviour is predictable — a user's own mpv may be old, oddly
 * configured, or a fork.
 *
 * mpv is shipped alongside the application rather than linked into it. It is
 * GPL, and keeping it a separate executable invoked over a socket is what
 * makes that mere aggregation rather than a derived work.
 */
export function locateMpv(configuredPath?: string | null): string | null {
  if (configuredPath && existsSync(configuredPath)) return configuredPath;

  const bundled = bundledMpvPath();
  if (bundled && existsSync(bundled)) return bundled;

  const executable = process.platform === "win32" ? "mpv.exe" : "mpv";

  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (!entry) continue;
    const candidate = join(entry, executable);
    if (existsSync(candidate)) return candidate;
  }

  if (process.platform === "win32") {
    for (const candidate of WINDOWS_CANDIDATES) {
      if (existsSync(candidate)) return candidate;
    }
  } else {
    for (const candidate of ["/usr/bin/mpv", "/usr/local/bin/mpv", "/opt/homebrew/bin/mpv"]) {
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Where the packaged application keeps mpv.
 *
 * `extraResources` places it under `resources/mpv`. In development that
 * directory does not exist, so the vendored copy the fetch script writes is
 * used instead and the same code path is exercised either way.
 */
function bundledMpvPath(): string | null {
  const executable = process.platform === "win32" ? "mpv.exe" : "mpv";

  if (app.isPackaged) return join(process.resourcesPath, "mpv", executable);

  // Development: apps/nova/vendor/mpv, next to the compiled bundle's parent.
  return join(app.getAppPath(), "vendor", "mpv", executable);
}

export class MpvNotInstalledError extends Error {
  constructor() {
    super(
      "mpv could not be found. It normally ships with Vestra — if this build was " +
        "packaged without it, install mpv and put it on your PATH, or set its " +
        "location in Settings.",
    );
    this.name = "MpvNotInstalledError";
  }
}

/* =============================================================================
 * Session state
 * ========================================================================== */

export interface MpvTrack {
  id: number;
  type: "video" | "audio" | "sub";
  title: string | null;
  language: string | null;
  codec: string | null;
  selected: boolean;
  /** External files loaded alongside the media, rather than muxed into it. */
  external: boolean;
}

export interface MpvState {
  running: boolean;
  idle: boolean;
  paused: boolean;
  position: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** Playback rate, 1 being normal. */
  speed: number;
  /** Subtitle timing offset in seconds; negative shows them earlier. */
  subtitleDelay: number;
  /** Subtitle size multiplier. */
  subtitleScale: number;
  /** True once the file has played to its end. */
  ended: boolean;
  tracks: MpvTrack[];
  subtitleVisible: boolean;
  /** Set when mpv reports a problem loading the file. */
  error: string | null;
}

const INITIAL_STATE: MpvState = {
  running: false,
  idle: true,
  paused: true,
  position: 0,
  duration: 0,
  volume: 1,
  muted: false,
  speed: 1,
  subtitleDelay: 0,
  subtitleScale: 1,
  ended: false,
  tracks: [],
  subtitleVisible: true,
  error: null,
};

/** Observed property ids. Values are arbitrary but must be stable. */
const OBSERVED = {
  timePos: 1,
  duration: 2,
  pause: 3,
  volume: 4,
  mute: 5,
  trackList: 6,
  eofReached: 7,
  subVisibility: 8,
  speed: 9,
  subDelay: 10,
  subScale: 11,
} as const;

export interface MpvOptions {
  mpvPath?: string | null;
  hardwareDecoding?: "auto-safe" | "auto" | "no";
  volume?: number;
}

export class MpvSession {
  #process: ChildProcess | null = null;
  #connection: MpvConnection | null = null;
  #state: MpvState = { ...INITIAL_STATE };
  #listeners = new Set<(state: MpvState) => void>();
  #starting: Promise<void> | null = null;
  /** Offsets gathered from rapid seek presses, applied together. */
  #pendingSeek = 0;
  #seekTimer: ReturnType<typeof setTimeout> | null = null;

  get state(): MpvState {
    return this.#state;
  }

  get running(): boolean {
    return this.#process !== null && this.#connection !== null;
  }

  onChange(listener: (state: MpvState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(patch: Partial<MpvState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }

  /**
   * Start mpv attached to a window.
   *
   * Concurrent callers share one startup: opening two files quickly should not
   * race two processes onto the same surface.
   */
  async start(window: BrowserWindow, options: MpvOptions = {}): Promise<void> {
    if (this.running) return;
    if (this.#starting) return this.#starting;

    this.#starting = this.#spawn(window, options).finally(() => {
      this.#starting = null;
    });

    return this.#starting;
  }

  async #spawn(window: BrowserWindow, options: MpvOptions): Promise<void> {
    const binary = locateMpv(options.mpvPath);
    if (!binary) throw new MpvNotInstalledError();

    // An unpredictable name: the pipe is a control channel, and a fixed name
    // would let any local process drive playback or load arbitrary files.
    const token = randomBytes(12).toString("hex");
    const pipePath =
      process.platform === "win32"
        ? `\\\\.\\pipe\\vestra-mpv-${token}`
        : join(app.getPath("temp"), `vestra-mpv-${token}.sock`);

    // The native handle of the window mpv should draw into. Windows and X11
    // both take a numeric handle; the buffer is little-endian.
    const handle = window.getNativeWindowHandle();
    const wid =
      process.platform === "win32"
        ? handle.readBigUInt64LE(0).toString()
        : handle.readUInt32LE(0).toString();

    const args = [
      `--input-ipc-server=${pipePath}`,
      `--wid=${wid}`,
      // Stay alive between files: restarting the process per episode would
      // throw away the window and flash.
      "--idle=yes",
      "--force-window=yes",
      "--keep-open=yes",
      // The application supplies the interface; mpv's own overlay and key
      // bindings would fight it.
      "--no-osc",
      "--no-osd-bar",
      "--no-input-default-bindings",
      "--input-vo-keyboard=no",
      "--no-terminal",
      `--hwdec=${options.hardwareDecoding ?? "auto-safe"}`,
      // Matroska fonts are attached to the file; libass needs them to render
      // styled subtitles the way the release intended.
      "--embeddedfonts=yes",
      "--sub-auto=fuzzy",
      "--msg-level=all=warn",
    ];

    if (typeof options.volume === "number") {
      args.push(`--volume=${Math.round(options.volume * 100)}`);
    }

    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.#process = child;

    child.on("exit", (code) => {
      this.#process = null;
      this.#connection?.close();
      this.#connection = null;
      this.#emit({
        ...INITIAL_STATE,
        error: code === 0 || code === null ? null : `mpv exited with code ${code}.`,
      });
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });

    child.on("error", (error) => {
      this.#emit({ error: `mpv could not be started: ${error.message}` });
    });

    const connection = new MpvConnection();
    try {
      await connection.connect(pipePath);
    } catch (error) {
      child.kill();
      this.#process = null;
      const detail = stderr.trim().split("\n").slice(-3).join(" ");
      throw new Error(
        `${error instanceof Error ? error.message : "mpv failed to start."}` +
          (detail ? ` mpv said: ${detail}` : ""),
      );
    }

    this.#connection = connection;
    connection.onEvent((event) => this.#handleEvent(event));

    for (const [name, id] of [
      ["time-pos", OBSERVED.timePos],
      ["duration", OBSERVED.duration],
      ["pause", OBSERVED.pause],
      ["volume", OBSERVED.volume],
      ["mute", OBSERVED.mute],
      ["track-list", OBSERVED.trackList],
      ["eof-reached", OBSERVED.eofReached],
      ["sub-visibility", OBSERVED.subVisibility],
      ["speed", OBSERVED.speed],
      ["sub-delay", OBSERVED.subDelay],
      ["sub-scale", OBSERVED.subScale],
    ] as const) {
      await connection.observeProperty(id, name);
    }

    this.#emit({ running: true, error: null });
  }

  #handleEvent(event: MpvEvent): void {
    if (event.event === "property-change") {
      switch (event.name) {
        case "time-pos":
          if (typeof event.data === "number") this.#emit({ position: event.data });
          break;
        case "duration":
          if (typeof event.data === "number") this.#emit({ duration: event.data });
          break;
        case "pause":
          if (typeof event.data === "boolean") this.#emit({ paused: event.data });
          break;
        case "volume":
          if (typeof event.data === "number") this.#emit({ volume: event.data / 100 });
          break;
        case "mute":
          if (typeof event.data === "boolean") this.#emit({ muted: event.data });
          break;
        case "speed":
          if (typeof event.data === "number") this.#emit({ speed: event.data });
          break;
        case "sub-delay":
          if (typeof event.data === "number") this.#emit({ subtitleDelay: event.data });
          break;
        case "sub-scale":
          if (typeof event.data === "number") this.#emit({ subtitleScale: event.data });
          break;
        case "sub-visibility":
          if (typeof event.data === "boolean") {
            this.#emit({ subtitleVisible: event.data });
          }
          break;
        case "eof-reached":
          if (typeof event.data === "boolean" && event.data) this.#emit({ ended: true });
          break;
        case "track-list":
          this.#emit({ tracks: parseTracks(event.data) });
          break;
      }
      return;
    }

    switch (event.event) {
      case "file-loaded":
        this.#emit({ idle: false, ended: false, error: null });
        break;
      case "end-file":
        // "eof" is a normal finish; anything else is a real failure worth
        // showing rather than silently returning to an idle screen.
        if (event.reason && event.reason !== "eof" && event.reason !== "stop") {
          this.#emit({ error: `Playback stopped: ${event.reason}`, idle: true });
        } else {
          this.#emit({ idle: true });
        }
        break;
      case "idle":
        this.#emit({ idle: true });
        break;
    }
  }

  #require(): MpvConnection {
    if (!this.#connection) throw new Error("mpv is not running.");
    return this.#connection;
  }

  async load(filePath: string, startSeconds = 0): Promise<void> {
    const connection = this.#require();
    this.#emit({ ended: false, error: null, position: 0, duration: 0 });

    // A queued seek belongs to the file being replaced.
    this.#cancelPendingSeek();

    /*
      Resume is set through the option rather than as a loadfile argument.

      mpv 0.38 redefined loadfile's third parameter from a list of options to
      an insertion index, so passing "start=..." there is rejected outright as
      an invalid parameter by any current build — this one is 0.41. Writing
      "options/start" means the same thing to every version, and applies to
      the next file loaded. It is written on every load, including back to
      "none", because it would otherwise persist and silently skip into the
      following episode.
    */
    await connection.setProperty(
      "options/start",
      startSeconds > 0 ? String(startSeconds) : "none",
    );
    await connection.command("loadfile", filePath, "replace");
  }

  async play(): Promise<void> {
    await this.#require().setProperty("pause", false);
  }

  async pause(): Promise<void> {
    await this.#require().setProperty("pause", true);
  }

  /**
   * Seek to a point.
   *
   * `exact` matters on these files: without it mpv lands on the nearest
   * keyframe, and with the long intervals a modern encode uses that can be
   * several seconds from where the scrub bar was released.
   */
  async seek(seconds: number): Promise<void> {
    await this.#require().command("seek", seconds, "absolute+exact");
  }

  /**
   * Seek by an offset from wherever playback actually is.
   *
   * Rapid presses are gathered into one jump. Three taps of "back ten" issued
   * separately would each read the position before any of them had landed,
   * compute the same target, and move ten seconds in total instead of thirty —
   * so the offsets are accumulated briefly and applied together, which also
   * avoids three decodes for one intent.
   *
   * mpv's own relative seek would avoid the round trip but is not accurate on
   * these files: asking for ten seconds measured between eleven and twenty
   * even with the exact flag set, while absolute seeks landed precisely.
   */
  seekBy(deltaSeconds: number): void {
    this.#pendingSeek += deltaSeconds;

    if (this.#seekTimer) clearTimeout(this.#seekTimer);
    this.#seekTimer = setTimeout(() => {
      void this.#flushSeek();
    }, 90);
  }

  async #flushSeek(): Promise<void> {
    const delta = this.#pendingSeek;
    this.#pendingSeek = 0;
    this.#seekTimer = null;

    if (delta === 0 || !this.#connection) return;

    const connection = this.#connection;

    const current = await connection
      .getProperty<number>("time-pos")
      .catch(() => null);

    if (typeof current !== "number" || !Number.isFinite(current)) return;

    const duration = await connection
      .getProperty<number>("duration")
      .catch(() => null);

    let target = Math.max(0, current + delta);

    // Stop just short of the end; seeking exactly to it ends the file.
    if (typeof duration === "number" && Number.isFinite(duration)) {
      target = Math.min(target, Math.max(0, duration - 1));
    }

    await this.seek(target).catch(() => undefined);
  }

  async setVolume(volume: number): Promise<void> {
    const clamped = Math.max(0, Math.min(1, volume));
    await this.#require().setProperty("volume", Math.round(clamped * 100));
  }

  async setMuted(muted: boolean): Promise<void> {
    await this.#require().setProperty("mute", muted);
  }

  async setSpeed(speed: number): Promise<void> {
    // mpv accepts a wide range; keep it to what is useful and reversible.
    const clamped = Math.max(0.25, Math.min(4, speed));
    await this.#require().setProperty("speed", clamped);
  }

  /** Shift subtitle timing. Negative values show them earlier. */
  async setSubtitleDelay(seconds: number): Promise<void> {
    const clamped = Math.max(-60, Math.min(60, seconds));
    await this.#require().setProperty("sub-delay", clamped);
  }

  async setSubtitleScale(scale: number): Promise<void> {
    const clamped = Math.max(0.5, Math.min(2.5, scale));
    await this.#require().setProperty("sub-scale", clamped);
  }

  /**
   * Subtitle appearance.
   *
   * Only applied when the user asks for it: ASS subtitles carry their own
   * styling, and overriding it by default would discard the typesetting the
   * release put there deliberately.
   */
  async setSubtitleStyleOverride(enabled: boolean): Promise<void> {
    await this.#require().setProperty("sub-ass-override", enabled ? "force" : "scale");
  }

  /** Select a track, or pass `null` to disable it (subtitles off). */
  async selectTrack(type: "audio" | "sub" | "video", id: number | null): Promise<void> {
    const property = type === "sub" ? "sid" : type === "audio" ? "aid" : "vid";
    await this.#require().setProperty(property, id ?? "no");
  }

  async setSubtitleVisible(visible: boolean): Promise<void> {
    await this.#require().setProperty("sub-visibility", visible);
  }

  async addSubtitleFile(filePath: string): Promise<void> {
    await this.#require().command("sub-add", filePath, "select");
  }

  async stop(): Promise<void> {
    if (!this.#connection) return;
    this.#cancelPendingSeek();
    await this.#connection.command("stop").catch(() => undefined);
    this.#emit({ idle: true, position: 0, duration: 0 });
  }

  #cancelPendingSeek(): void {
    if (this.#seekTimer) clearTimeout(this.#seekTimer);
    this.#seekTimer = null;
    this.#pendingSeek = 0;
  }

  /** Shut mpv down. Safe to call when it was never started. */
  dispose(): void {
    this.#cancelPendingSeek();
    this.#connection?.close();
    this.#connection = null;

    const child = this.#process;
    this.#process = null;

    if (child && !child.killed) {
      // Ask first; mpv releases the window handle on a clean quit, and killing
      // it outright can leave the surface painted over the interface.
      child.kill();
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 2000);
    }

    this.#emit({ ...INITIAL_STATE });
  }
}

interface RawTrack {
  id?: number;
  type?: string;
  title?: string;
  lang?: string;
  codec?: string;
  selected?: boolean;
  external?: boolean;
}

function parseTracks(data: unknown): MpvTrack[] {
  if (!Array.isArray(data)) return [];

  const tracks: MpvTrack[] = [];

  for (const entry of data as RawTrack[]) {
    const type = entry.type;
    if (type !== "video" && type !== "audio" && type !== "sub") continue;
    if (typeof entry.id !== "number") continue;

    tracks.push({
      id: entry.id,
      type,
      title: entry.title ?? null,
      language: entry.lang ?? null,
      codec: entry.codec ?? null,
      selected: entry.selected === true,
      external: entry.external === true,
    });
  }

  return tracks;
}
