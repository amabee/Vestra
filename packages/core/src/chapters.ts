/**
 * Skip ranges derived from a file's own chapter markers.
 *
 * The better source when it exists, because it comes from the file rather than
 * from a community database keyed by a series id — no season to get wrong, no
 * episode numbering to line up, and nothing to look up over the network.
 *
 * Only what the chapters actually claim is used. A chapter named "Opening" is
 * a fact; assuming the first ninety seconds of any episode is an opening is
 * not, and would cut into cold opens.
 *
 * Most releases carry no chapters at all, so this returning nothing is the
 * ordinary case rather than a failure.
 */

const OPENING = /\b(op|opening|intro|avant)\b/i;
const ENDING = /\b(ed|ending|outro|credits|preview)\b/i;

/** A range worth offering to skip. */
export interface SkipRange {
  kind: "opening" | "ending";
  startSeconds: number;
  endSeconds: number;
  /**
   * Identifier for the submission a range came from, where it came from one.
   *
   * Chapters are read out of the file itself, so they have none — there is
   * nobody to report a bad chapter to but whoever encoded it.
   */
  skipId?: string | null;
}

/** A chapter marker, as either mpv or ffprobe describes one. */
export interface ChapterMark {
  title: string | null;
  startSeconds: number;
  /** Where the chapter ends. Taken from the next chapter when not given. */
  endSeconds?: number;
}

/**
 * Read opening and ending ranges out of chapter titles.
 *
 * `duration` closes the final chapter, which otherwise has no end. Without it
 * a trailing "Ending" chapter is discarded rather than guessed at.
 */
export function skipRangesFromChapters(
  chapters: readonly ChapterMark[],
  duration = 0,
): SkipRange[] {
  const ordered = [...chapters].sort((a, b) => a.startSeconds - b.startSeconds);
  const ranges: SkipRange[] = [];

  for (const [index, chapter] of ordered.entries()) {
    const kind = classify(chapter.title);
    if (!kind) continue;

    const end = chapter.endSeconds ?? ordered[index + 1]?.startSeconds ?? duration;
    if (!Number.isFinite(end) || end <= chapter.startSeconds) continue;

    ranges.push({
      kind,
      startSeconds: chapter.startSeconds,
      endSeconds: end,
    });
  }

  return ranges;
}

function classify(title: string | null): SkipRange["kind"] | null {
  if (!title) return null;
  if (OPENING.test(title)) return "opening";
  if (ENDING.test(title)) return "ending";
  return null;
}

/**
 * Chapters where they exist, otherwise whatever was looked up.
 *
 * Not merged range by range. The two sources describe the same episode, and
 * interleaving them would let a community timing for the opening sit beside a
 * chapter-derived ending from a differently cut release. Whichever source is
 * used, it is used for the whole episode.
 */
export function preferChapters(
  fromChapters: readonly SkipRange[],
  fallback: readonly SkipRange[],
): SkipRange[] {
  return fromChapters.length > 0 ? [...fromChapters] : [...fallback];
}
