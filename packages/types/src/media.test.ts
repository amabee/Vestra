import { describe, expect, it } from "vitest";

import {
  extensionIdFromSource,
  isExtensionSource,
  mediaKey,
  mediaSourceSchema,
  parseMediaKey,
  toExtensionSource,
} from "./media";

/**
 * A ref is serialised into storage keys, URLs and progress records, so a key
 * that does not survive a round trip does not fail loudly — it quietly points
 * at a different item than the one it was written for.
 */

describe("media keys", () => {
  it("round-trips a first-party ref", () => {
    const ref = { source: "anilist" as const, kind: "anime" as const, sourceId: "146850" };

    expect(mediaKey(ref)).toBe("anilist:anime:146850");
    expect(parseMediaKey(mediaKey(ref))).toEqual(ref);
  });

  it("round-trips an extension ref", () => {
    // The reason the prefix is a hyphen: with "ext:kitsu" this parses back as
    // source "ext", kind "kitsu", and the id is silently wrong.
    const ref = {
      source: toExtensionSource("kitsu"),
      kind: "anime" as const,
      sourceId: "42",
    };

    expect(mediaKey(ref)).toBe("ext-kitsu:anime:42");
    expect(parseMediaKey(mediaKey(ref))).toEqual(ref);
  });

  it("keeps colons that belong to the id", () => {
    const ref = {
      source: "mediaserver" as const,
      kind: "tv" as const,
      sourceId: "series:1:2",
    };

    expect(parseMediaKey(mediaKey(ref))).toEqual(ref);
  });

  it("rejects a key naming an unknown source", () => {
    expect(parseMediaKey("nowhere:anime:1")).toBeNull();
  });

  it("rejects a malformed key", () => {
    expect(parseMediaKey("anilist:anime")).toBeNull();
    expect(parseMediaKey("")).toBeNull();
  });
});

describe("extension sources", () => {
  it("accepts first-party sources", () => {
    for (const source of ["anilist", "tmdb", "youtube", "local", "mediaserver"]) {
      expect(mediaSourceSchema.safeParse(source).success, source).toBe(true);
    }
  });

  it("accepts a namespaced extension source", () => {
    expect(mediaSourceSchema.safeParse("ext-kitsu").success).toBe(true);
    expect(mediaSourceSchema.safeParse("ext-my.extension_1").success).toBe(true);
  });

  it("refuses an unprefixed name, so an extension cannot pose as a provider", () => {
    // The prefix is added by the host from the extension id. An extension
    // claiming "anilist" outright must not validate as that provider.
    expect(mediaSourceSchema.safeParse("kitsu").success).toBe(false);
    expect(mediaSourceSchema.safeParse("").success).toBe(false);
  });

  it("refuses an extension source with a colon in it", () => {
    // Would break the key round trip.
    expect(mediaSourceSchema.safeParse("ext-a:b").success).toBe(false);
  });

  it("names the extension behind a source", () => {
    expect(extensionIdFromSource("ext-kitsu")).toBe("kitsu");
    expect(extensionIdFromSource("anilist")).toBeNull();
  });

  it("tells the two kinds of source apart", () => {
    expect(isExtensionSource("ext-kitsu")).toBe(true);
    expect(isExtensionSource("anilist")).toBe(false);
  });
});
