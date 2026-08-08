import { spawn } from "node:child_process";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { app } from "electron";
import { getLocalFiles, saveLocalFiles, type StorageDriver } from "@vestra/storage";
import type { LocalMediaFile } from "@vestra/types";

import { locateMpv } from "./mpv/session";

/**
 * Runtimes and still frames for indexed files.
 *
 * The episode list has room for both and neither was ever filled: the scanner
 * reads what the filesystem knows — name, size, mtime — and nothing that
 * requires opening the file.
 *
 * mpv does the work rather than ffprobe. ffprobe is a development dependency
 * and is deliberately not shipped, so in a packaged app it degrades to a PATH
 * lookup that usually finds nothing; mpv is bundled, is already required for
 * playback, and produces the duration and the frame in a single pass. Measured
 * at ~390ms per file for the HEVC releases this was built against.
 */

/** Where the frame is taken from. Far enough in to clear titles and logos. */
const THUMBNAIL_POSITION = "25%";

/** Wide enough for a list row at 2x, ~14KB as JPEG. */
const THUMBNAIL_WIDTH = 320;

/** A file that cannot be read in this long is not worth holding the queue for. */
const PROBE_TIMEOUT_MS = 20_000;

/** Breathing room between files so a backfill cannot monopolise the disk. */
const PAUSE_BETWEEN_MS = 150;

export interface MediaInfo {
  durationSeconds: number | null;
  thumbnailPath: string | null;
}

export function thumbnailDir(): string {
  return join(app.getPath("userData"), "thumbnails");
}

/**
 * Read a file's duration and save a still from it.
 *
 * Both come from one mpv invocation: `--frames=1` decodes a single frame at
 * the seek position and the image video output writes it out, while
 * `--term-playing-msg` prints the duration on the way past.
 *
 * The image output names its own files by frame number, so the frame lands in
 * a scratch directory and is renamed. Probes run one at a time, so the scratch
 * directory cannot be contended.
 */
export async function probeMediaInfo(
  filePath: string,
  fileId: string,
): Promise<MediaInfo> {
  const binary = locateMpv();
  if (!binary) return { durationSeconds: null, thumbnailPath: null };

  const directory = thumbnailDir();
  const scratch = join(directory, ".scratch");

  await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  await mkdir(scratch, { recursive: true });

  const output = await run(binary, [
    filePath,
    // The user's own mpv.conf must not change what is written here.
    "--no-config",
    "--no-audio",
    `--start=${THUMBNAIL_POSITION}`,
    "--frames=1",
    "--vo=image",
    "--vo-image-format=jpg",
    "--vo-image-jpeg-quality=80",
    `--vo-image-outdir=${scratch}`,
    `--vf=scale=${THUMBNAIL_WIDTH}:-2`,
    "--term-playing-msg=VESTRA_DURATION=${=duration}",
  ]);

  const durationSeconds = readDuration(output);
  const thumbnailPath = await collectFrame(scratch, directory, fileId);

  await rm(scratch, { recursive: true, force: true }).catch(() => undefined);

  return { durationSeconds, thumbnailPath };
}

function readDuration(output: string): number | null {
  const match = /VESTRA_DURATION=([0-9.]+)/.exec(output);
  if (!match?.[1]) return null;

  const seconds = Number.parseFloat(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/** Move the single frame mpv wrote into place, named for the file it came from. */
async function collectFrame(
  scratch: string,
  directory: string,
  fileId: string,
): Promise<string | null> {
  let written: string[];
  try {
    written = await readdir(scratch);
  } catch {
    return null;
  }

  const frame = written.find((name) => name.endsWith(".jpg"));
  if (!frame) return null;

  const destination = join(directory, `${fileId}.jpg`);

  try {
    await rename(join(scratch, frame), destination);
    return destination;
  } catch {
    return null;
  }
}

function run(binary: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(binary, [...args], { windowsHide: true });

    let output = "";
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
    };

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    const timer = setTimeout(() => child.kill(), PROBE_TIMEOUT_MS);

    const finish = () => {
      clearTimeout(timer);
      resolve(output);
    };

    child.on("close", finish);
    // A missing or unrunnable binary is not fatal; nothing gets filled in.
    child.on("error", finish);
  });
}

/**
 * Fill in whatever is still missing, one file at a time.
 *
 * Deliberately not part of scanning. Indexing a folder is a filesystem walk
 * and finishes in a moment, whereas opening several hundred files does not,
 * and burying that inside the scan would leave the UI waiting with nothing to
 * show for it. The library is usable immediately and details arrive after.
 */
export async function backfillMediaInfo(
  driver: StorageDriver,
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  if (!locateMpv()) return 0;

  await mkdir(thumbnailDir(), { recursive: true });

  const pending: LocalMediaFile[] = [];
  for (const file of await getLocalFiles(driver)) {
    if (await needsInfo(file)) pending.push(file);
  }

  if (pending.length === 0) return 0;

  let filled = 0;

  for (const [index, file] of pending.entries()) {
    const info = await probeMediaInfo(file.path, file.id);
    if (info.durationSeconds === null && info.thumbnailPath === null) continue;

    /*
      Re-read and re-save per file rather than batching.

      A backfill outlives most things the user is doing, and a scan or a
      re-match part way through would otherwise be overwritten wholesale by a
      stale copy held since the loop began.
    */
    const current = await getLocalFiles(driver);
    const updated = current.map((entry) =>
      entry.id === file.id
        ? {
            ...entry,
            durationSeconds: info.durationSeconds ?? entry.durationSeconds,
            thumbnailPath: info.thumbnailPath ?? entry.thumbnailPath,
          }
        : entry,
    );

    await saveLocalFiles(driver, updated);
    filled += 1;
    onProgress?.(index + 1, pending.length);

    await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_MS));
  }

  return filled;
}

/**
 * Whether anything is still missing for a file.
 *
 * The still is checked on disk rather than taken on trust: a record can name
 * one the user has since cleared out, and without the check it would never be
 * taken again.
 */
async function needsInfo(file: LocalMediaFile): Promise<boolean> {
  if (file.durationSeconds === null) return true;
  if (!file.thumbnailPath) return true;

  try {
    return !(await stat(file.thumbnailPath)).isFile();
  } catch {
    return true;
  }
}

/** Drop stills for files that are no longer indexed. */
export async function pruneThumbnails(driver: StorageDriver): Promise<number> {
  const directory = thumbnailDir();

  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return 0;
  }

  const known = new Set((await getLocalFiles(driver)).map((file) => `${file.id}.jpg`));
  let removed = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".jpg") || known.has(entry)) continue;
    await rm(join(directory, entry), { force: true }).catch(() => undefined);
    removed += 1;
  }

  return removed;
}
