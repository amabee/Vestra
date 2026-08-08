import { describe, expect, it } from "vitest";

import { preferChapters, skipRangesFromChapters, type SkipRange } from "./chapters";

/**
 * Chapters are the better skip source when a release carries them, so the
 * reading has to be exact: a false positive cuts into the episode, and a
 * missed ending leaves the button absent when it was promised.
 */

describe("skipRangesFromChapters", () => {
  it("reads an opening and an ending from their titles", () => {
    const ranges = skipRangesFromChapters([
      { title: "Intro", startSeconds: 0 },
      { title: "Opening", startSeconds: 115 },
      { title: "Part A", startSeconds: 205 },
      { title: "Ending", startSeconds: 1265 },
      { title: "Preview", startSeconds: 1355 },
    ]);

    // "Preview" is last and no runtime was given, so it has no end and is
    // dropped rather than guessed at.
    expect(ranges).toEqual<SkipRange[]>([
      { kind: "opening", startSeconds: 0, endSeconds: 115 },
      { kind: "opening", startSeconds: 115, endSeconds: 205 },
      { kind: "ending", startSeconds: 1265, endSeconds: 1355 },
    ]);
  });

  it("closes the last chapter with the runtime", () => {
    const ranges = skipRangesFromChapters(
      [
        { title: "Episode", startSeconds: 0 },
        { title: "Ending", startSeconds: 1265 },
      ],
      1431,
    );

    expect(ranges).toEqual<SkipRange[]>([
      { kind: "ending", startSeconds: 1265, endSeconds: 1431 },
    ]);
  });

  it("drops a trailing marker when no runtime is known", () => {
    // Better to offer nothing than to skip to a position that was guessed.
    expect(skipRangesFromChapters([{ title: "Ending", startSeconds: 1265 }])).toEqual([]);
  });

  it("ignores chapters that name neither", () => {
    const ranges = skipRangesFromChapters(
      [
        { title: "Part A", startSeconds: 0 },
        { title: "Part B", startSeconds: 600 },
        { title: null, startSeconds: 900 },
      ],
      1200,
    );

    expect(ranges).toEqual([]);
  });

  it("matches whole words only", () => {
    // "Operation" and "Wedding" contain op and ed but are not markers.
    const ranges = skipRangesFromChapters(
      [
        { title: "Operation Begins", startSeconds: 0 },
        { title: "The Wedding", startSeconds: 600 },
      ],
      1200,
    );

    expect(ranges).toEqual([]);
  });

  it("orders chapters before pairing them", () => {
    const ranges = skipRangesFromChapters(
      [
        { title: "Ending", startSeconds: 1265 },
        { title: "Opening", startSeconds: 115 },
        { title: "Part A", startSeconds: 205 },
      ],
      1431,
    );

    expect(ranges).toEqual<SkipRange[]>([
      { kind: "opening", startSeconds: 115, endSeconds: 205 },
      { kind: "ending", startSeconds: 1265, endSeconds: 1431 },
    ]);
  });

  it("uses an explicit end when the source supplies one", () => {
    const ranges = skipRangesFromChapters([
      { title: "Opening", startSeconds: 115, endSeconds: 205 },
    ]);

    expect(ranges).toEqual<SkipRange[]>([
      { kind: "opening", startSeconds: 115, endSeconds: 205 },
    ]);
  });

  it("discards a range that does not move forward", () => {
    const ranges = skipRangesFromChapters([
      { title: "Opening", startSeconds: 115, endSeconds: 115 },
    ]);

    expect(ranges).toEqual([]);
  });
});

describe("preferChapters", () => {
  const chapter: SkipRange = { kind: "opening", startSeconds: 115, endSeconds: 205 };
  const community: SkipRange = { kind: "opening", startSeconds: 166, endSeconds: 256 };

  it("uses the file's own chapters when it has them", () => {
    expect(preferChapters([chapter], [community])).toEqual([chapter]);
  });

  it("falls back to the lookup when the file has none", () => {
    expect(preferChapters([], [community])).toEqual([community]);
  });

  it("does not interleave the two sources", () => {
    // One release's chapters beside another's community timings would put a
    // skip button in a place neither source claims.
    expect(preferChapters([chapter], [community])).toHaveLength(1);
  });

  it("is empty when neither source knows anything", () => {
    expect(preferChapters([], [])).toEqual([]);
  });
});
