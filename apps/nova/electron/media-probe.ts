import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { promisify } from "node:util";

import { skipRangesFromChapters, type SkipRange } from "@vestra/core/chapters";

const run = promisify(execFile);

/**
 * Media probing.
 *
 * Chromium decodes a narrow set of formats, and the files this app is for —
 * anime, usually MKV — routinely fall outside it. Without probing, an
 * unplayable file is a black screen and a guess. With it, the app can say
 * "this is HEVC video with AC-3 audio, Chromium decodes neither" before
 * playback is attempted.
 *
 * ffprobe is NOT bundled. The binary is ~77MB per platform, which is a large
 * tax to put on every installer for a feature that degrades cleanly without
 * it. It is resolved from an explicit setting, then PATH, then the dev
 * dependency — so it works during development and remains an opt-in for
 * distribution.
 */

export interface MediaStreamInfo {
  index: number;
  codec: string;
  /** ISO language tag from the container, when tagged. */
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
}

export interface VideoStreamInfo extends MediaStreamInfo {
  width: number | null;
  height: number | null;
  /** 8, 10 or 12. 10-bit is common in anime and matters for decode support. */
  bitDepth: number | null;
}

export interface AudioStreamInfo extends MediaStreamInfo {
  channels: number | null;
}

export interface ChapterInfo {
  startSeconds: number;
  endSeconds: number;
  title: string | null;
}

export interface PlayabilityReport {
  /** Chromium can decode the default video stream. */
  video: boolean;
  /** Chromium can decode the default audio stream. */
  audio: boolean;
  /** Plain-language reasons, empty when playable. */
  reasons: string[];
}

export interface ProbeResult {
  durationSeconds: number | null;
  container: string | null;
  video: VideoStreamInfo[];
  audio: AudioStreamInfo[];
  subtitles: MediaStreamInfo[];
  chapters: ChapterInfo[];
  playable: PlayabilityReport;
}

export class ProbeUnavailableError extends Error {
  constructor() {
    super(
      "ffprobe was not found. Install FFmpeg and make sure ffprobe is on your PATH, " +
        "or set its location in Settings.",
    );
    this.name = "ProbeUnavailableError";
  }
}

/* =============================================================================
 * Codec support
 * ========================================================================== */

/**
 * What Chromium will decode.
 *
 * Deliberately conservative. HEVC is listed as unsupported even though some
 * platforms have hardware decode, because whether it works depends on the OS,
 * the GPU and how Electron was built — promising it and failing is worse than
 * warning and succeeding.
 */
const CHROMIUM_VIDEO = new Set(["h264", "vp8", "vp9", "av1", "theora"]);
const CHROMIUM_AUDIO = new Set(["aac", "mp3", "opus", "vorbis", "flac", "pcm_s16le"]);

const CODEC_LABEL: Record<string, string> = {
  hevc: "H.265/HEVC",
  h264: "H.264",
  av1: "AV1",
  vp9: "VP9",
  ac3: "Dolby Digital (AC-3)",
  eac3: "Dolby Digital Plus (E-AC-3)",
  dts: "DTS",
  truehd: "Dolby TrueHD",
  aac: "AAC",
  flac: "FLAC",
  opus: "Opus",
};

function label(codec: string): string {
  return CODEC_LABEL[codec] ?? codec.toUpperCase();
}

function assessPlayability(
  video: VideoStreamInfo[],
  audio: AudioStreamInfo[],
): PlayabilityReport {
  const reasons: string[] = [];

  const primaryVideo = video.find((stream) => stream.isDefault) ?? video[0];
  const primaryAudio = audio.find((stream) => stream.isDefault) ?? audio[0];

  const videoOk = primaryVideo ? CHROMIUM_VIDEO.has(primaryVideo.codec) : true;
  const audioOk = primaryAudio ? CHROMIUM_AUDIO.has(primaryAudio.codec) : true;

  if (primaryVideo && !videoOk) {
    reasons.push(`${label(primaryVideo.codec)} video cannot be decoded in the app.`);
  }

  if (primaryAudio && !audioOk) {
    reasons.push(`${label(primaryAudio.codec)} audio cannot be decoded in the app.`);
  }

  // 10-bit H.264 is a common anime encode that Chromium refuses even though it
  // accepts 8-bit H.264, which makes for a confusing failure without this note.
  if (primaryVideo?.codec === "h264" && (primaryVideo.bitDepth ?? 8) > 8) {
    reasons.push("10-bit H.264 is not supported by Chromium's decoder.");
  }

  return { video: videoOk, audio: audioOk, reasons };
}

/* =============================================================================
 * Binary resolution
 * ========================================================================== */

let cachedBinary: string | null | undefined;

/** Explicit path wins, then the dev dependency, then PATH. */
export function resolveFfprobe(configuredPath?: string | null): string | null {
  if (configuredPath && existsSync(configuredPath)) return configuredPath;

  if (cachedBinary !== undefined) return cachedBinary;

  try {
    // Marked external in the esbuild config, so this is a genuine runtime
    // lookup: present in development, absent from the packaged app.
    const require = createRequire(__filename);
    const installer = require("@ffprobe-installer/ffprobe") as { path?: string };
    if (installer.path && existsSync(installer.path)) {
      cachedBinary = installer.path;
      return cachedBinary;
    }
  } catch {
    /* not installed — fall through to PATH */
  }

  // A bare name lets the OS resolve it from PATH; if it is not there, the
  // spawn fails with ENOENT and is reported as ProbeUnavailableError.
  cachedBinary = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  return cachedBinary;
}

/* =============================================================================
 * Probing
 * ========================================================================== */

interface RawStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  disposition?: Record<string, number>;
  tags?: Record<string, string>;
}

interface RawChapter {
  start_time?: string;
  end_time?: string;
  tags?: Record<string, string>;
}

interface RawProbe {
  format?: { duration?: string; format_name?: string };
  streams?: RawStream[];
  chapters?: RawChapter[];
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Bit depth of a video stream.
 *
 * `bits_per_raw_sample` is frequently absent in Matroska files, so the pixel
 * format is the reliable source: `yuv420p10le` is 10-bit. This matters because
 * 10-bit is the line Chromium's H.264 decoder refuses to cross.
 */
function bitDepthOf(stream: RawStream): number | null {
  const declared = stream.bits_per_raw_sample
    ? Number.parseInt(stream.bits_per_raw_sample, 10)
    : Number.NaN;
  if (Number.isFinite(declared)) return declared;

  const match = stream.pix_fmt?.match(/(\d{1,2})(le|be)$/);
  if (match?.[1]) return Number.parseInt(match[1], 10);

  // No suffix means 8-bit for the standard planar formats.
  return stream.pix_fmt ? 8 : null;
}

function common(stream: RawStream): MediaStreamInfo {
  return {
    index: stream.index,
    codec: stream.codec_name ?? "unknown",
    language: stream.tags?.language ?? null,
    title: stream.tags?.title ?? null,
    isDefault: stream.disposition?.default === 1,
    isForced: stream.disposition?.forced === 1,
  };
}

/**
 * Probe results keyed by path.
 *
 * A probe costs an process spawn and ~100ms; a library view would otherwise pay
 * that for every file every time it renders.
 */
const cache = new Map<string, ProbeResult>();

export async function probeMedia(
  filePath: string,
  configuredPath?: string | null,
): Promise<ProbeResult> {
  const cached = cache.get(filePath);
  if (cached) return cached;

  const binary = resolveFfprobe(configuredPath);
  if (!binary) throw new ProbeUnavailableError();

  let stdout: string;
  try {
    ({ stdout } = await run(
      binary,
      [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-show_chapters",
        filePath,
      ],
      // A malformed file can make ffprobe read a long way before giving up.
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024 },
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ENOENT")) throw new ProbeUnavailableError();
    throw new Error(`Could not read this file: ${message}`);
  }

  let raw: RawProbe;
  try {
    raw = JSON.parse(stdout) as RawProbe;
  } catch {
    throw new Error("ffprobe returned output that could not be read.");
  }

  const streams = raw.streams ?? [];

  const video: VideoStreamInfo[] = streams
    .filter((stream) => stream.codec_type === "video")
    .map((stream) => ({
      ...common(stream),
      width: stream.width ?? null,
      height: stream.height ?? null,
      bitDepth: bitDepthOf(stream),
    }));

  const audio: AudioStreamInfo[] = streams
    .filter((stream) => stream.codec_type === "audio")
    .map((stream) => ({ ...common(stream), channels: stream.channels ?? null }));

  const subtitles = streams
    .filter((stream) => stream.codec_type === "subtitle")
    .map(common);

  const chapters: ChapterInfo[] = (raw.chapters ?? []).map((chapter) => ({
    startSeconds: toNumber(chapter.start_time) ?? 0,
    endSeconds: toNumber(chapter.end_time) ?? 0,
    title: chapter.tags?.title ?? null,
  }));

  const result: ProbeResult = {
    durationSeconds: toNumber(raw.format?.duration),
    container: raw.format?.format_name ?? null,
    video,
    audio,
    subtitles,
    chapters,
    playable: assessPlayability(video, audio),
  };

  cache.set(filePath, result);
  return result;
}

/* =============================================================================
 * Chapters → skip points
 * ========================================================================== */

export type SkipPoint = SkipRange;

/**
 * Derive skip ranges from chapter titles.
 *
 * The reading lives in core so that the player, which gets its chapters from
 * mpv rather than from here, cannot drift from this.
 */
export function skipPointsFrom(chapters: readonly ChapterInfo[]): SkipPoint[] {
  return skipRangesFromChapters(chapters);
}
