import { describe, expect, it } from "vitest";
import { MemoryDriver } from "@vestra/storage";
import { ContinueShelf, getContinueShelf } from "./continue-shelf";
import {
  continueKey,
  continueTargetSchema,
  hiddenFromContinue,
} from "../shared/continue-shelf";

const anime = {
  kind: "anime",
  ref: { kind: "anime", source: "anilist", sourceId: "123" },
} as const;
const manga = { kind: "manga", source: "foundry.asura", book: "123" } as const;

describe("Continue shelf dismissal", () => {
  it("persists independently of progress, history and lists, and supports Undo", async () => {
    const driver = new MemoryDriver();
    await driver.write("watch-progress-v1", { saved: true });
    await driver.write("watchlist-v1", [anime.ref]);
    const shelf = new ContinueShelf(driver, () => 100);
    const rows = await shelf.change(anime, true);
    expect(hiddenFromContinue(anime, 90, rows)).toBe(true);
    expect(await new ContinueShelf(driver).list()).toEqual(rows);
    expect(await driver.read("watch-progress-v1")).toEqual({ saved: true });
    expect(await driver.read("watchlist-v1")).toEqual([anime.ref]);
    expect(await shelf.change(anime, false)).toEqual({});
  });

  it("serializes simultaneous dismissals and shares the queue with progress saves", async () => {
    const driver = new MemoryDriver();
    const shelf = getContinueShelf(driver);
    expect(getContinueShelf(driver)).toBe(shelf);
    await Promise.all([shelf.change(anime, true), shelf.change(manga, true)]);
    expect(Object.keys(await shelf.list())).toHaveLength(2);
    await shelf.change(manga, false);
    expect(Object.keys(await shelf.list())).toEqual([continueKey(anime)]);
  });

  it("scopes manga to its source and anime to its media identity", async () => {
    const rows = await new ContinueShelf(new MemoryDriver(), () => 100).change(
      manga,
      true,
    );
    expect(hiddenFromContinue(manga, 99, rows)).toBe(true);
    expect(
      hiddenFromContinue({ ...manga, source: "other-source" }, 99, rows),
    ).toBe(false);
    expect(hiddenFromContinue(anime, 99, rows)).toBe(false);
    expect(hiddenFromContinue(manga, 101, rows)).toBe(false);
    expect(hiddenFromContinue(manga, 100, rows)).toBe(true);
  });

  it("recovers its write queue after a storage failure", async () => {
    const driver = new MemoryDriver();
    const shelf = new ContinueShelf(driver);
    const original = driver.write.bind(driver);
    driver.write = async () => {
      throw Error("Disk unavailable");
    };
    await expect(shelf.change(anime, true)).rejects.toThrow("Disk unavailable");
    driver.write = original;
    expect(await shelf.change(manga, true)).toHaveProperty(continueKey(manga));
  });

  it("avoids writing on normal progress saves when no title was dismissed", async () => {
    const driver = new MemoryDriver();
    expect(await new ContinueShelf(driver).change(manga, false)).toEqual({});
    expect(await driver.list()).toEqual([]);
  });

  it("validates the IPC target instead of accepting other media kinds", () => {
    expect(
      continueTargetSchema.safeParse({
        ...anime,
        ref: { ...anime.ref, kind: "movie" },
      }).success,
    ).toBe(false);
    expect(continueTargetSchema.safeParse({ ...manga, book: "" }).success).toBe(
      false,
    );
    expect(
      continueTargetSchema.safeParse({ kind: "manga", source: "x", book: "a" })
        .success,
    ).toBe(true);
  });
});
