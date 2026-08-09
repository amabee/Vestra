import { describe, expect, it } from "vitest";

import { adapt, adaptAll } from "./adapt";
import { parseManifest } from "./manifest";
import { canActAsProvider, canActAsStreamSource } from "./provider";
import { StreamSourceRegistry } from "./stream-registry";
import {
  parseAnimeResults,
  parseEpisodes,
  parseStreamResults,
  type StreamResult,
} from "./stream-types";

/**
 * These cover the boundary, not the plumbing. Everything asserted here is
 * something a hostile or careless extension could send, because that is the
 * only input this layer ever sees.
 */

const anime = (over: Record<string, unknown> = {}) => ({
  id: "title-1",
  title: "Placeholder",
  provider: "ext-example",
  ...over,
});

const stream = (over: Record<string, unknown> = {}): unknown => ({
  server: "A",
  videoSources: [{ url: "https://example.com/a.m3u8", quality: "1080p", type: "hls" }],
  ...over,
});

describe("parseAnimeResults", () => {
  it("accepts a well-formed result", () => {
    const { value, errors } = parseAnimeResults([anime()]);

    expect(errors).toEqual([]);
    expect(value).toHaveLength(1);
    expect(value?.[0]?.id).toBe("title-1");
  });

  it("refuses a non-array outright", () => {
    // A guest returning an object has misunderstood the contract, which is a
    // different failure from having patchy data and is not worth salvaging.
    const { value, errors } = parseAnimeResults({ id: "x" });

    expect(value).toBeNull();
    expect(errors[0]).toContain("must return an array");
  });

  it("drops bad entries but keeps the good ones", () => {
    const { value, errors } = parseAnimeResults([anime(), { id: "" }, anime({ id: "b" })]);

    expect(value).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it("rejects a plaintext cover", () => {
    const { value } = parseAnimeResults([anime({ cover: "http://example.com/a.jpg" })]);

    expect(value).toEqual([]);
  });

  it("caps how much one call can return", () => {
    const { value } = parseAnimeResults(
      Array.from({ length: 200 }, (_, index) => anime({ id: `t${index}` })),
    );

    expect(value?.length).toBe(50);
  });
});

describe("parseEpisodes", () => {
  it("keeps episode 0 and decimal numbers", () => {
    // Sources use 0 for a prologue and decimals for recaps. Treating `number`
    // as an index would silently renumber both.
    const { value } = parseEpisodes([
      { id: "e0", animeId: "t", number: 0 },
      { id: "e5", animeId: "t", number: 5.5 },
    ]);

    expect(value?.map((episode) => episode.number)).toEqual([0, 5.5]);
  });

  it("rejects a negative number", () => {
    const { value } = parseEpisodes([{ id: "e", animeId: "t", number: -1 }]);

    expect(value).toEqual([]);
  });
});

describe("parseStreamResults", () => {
  it("accepts a well-formed result", () => {
    const { value, errors } = parseStreamResults([stream()]);

    expect(errors).toEqual([]);
    expect(value?.[0]?.videoSources[0]?.type).toBe("hls");
  });

  it("rejects a container the player does not understand", () => {
    // `m3u8` is what several sources call HLS. It must be normalised in the
    // adapter, because an unrecognised type reaches the player as a stall.
    const { value } = parseStreamResults([
      stream({
        videoSources: [{ url: "https://example.com/a", quality: "auto", type: "m3u8" }],
      }),
    ]);

    expect(value).toEqual([]);
  });

  it("rejects a plaintext stream url", () => {
    const { value } = parseStreamResults([
      stream({
        videoSources: [{ url: "http://example.com/a.mp4", quality: "720p", type: "mp4" }],
      }),
    ]);

    expect(value).toEqual([]);
  });

  it("rejects a server with no sources", () => {
    const { value } = parseStreamResults([stream({ videoSources: [] })]);

    expect(value).toEqual([]);
  });

  it("rejects an oversized header map", () => {
    const headers = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`X-H${index}`, "v"]),
    );

    const { value } = parseStreamResults([stream({ headers })]);

    expect(value).toEqual([]);
  });

  it("rejects a malformed header name", () => {
    const { value } = parseStreamResults([stream({ headers: { "Bad Header": "v" } })]);

    expect(value).toEqual([]);
  });
});

describe("capability gates", () => {
  it("requires all three methods for a stream source", () => {
    // Unlike metadata, a partial stream source fails only after the user has
    // picked an episode.
    expect(canActAsStreamSource(["search", "getEpisodes", "getStreams"])).toBe(true);
    expect(canActAsStreamSource(["search", "getEpisodes"])).toBe(false);
    expect(canActAsStreamSource(["search"])).toBe(false);
  });

  it("stays independent of the metadata gate", () => {
    expect(canActAsProvider(["search"])).toBe(true);
    expect(canActAsStreamSource(["search"])).toBe(false);
  });
});

describe("manifest role", () => {
  const base = {
    id: "x",
    name: "X",
    version: "1.0.0",
    main: "index.js",
    sdkVersion: "1.0.0",
  };

  it("defaults to metadata so existing installs are unaffected", () => {
    const { manifest } = parseManifest(base);

    expect(manifest?.role).toBe("metadata");
  });

  it("accepts stream-source", () => {
    const { manifest } = parseManifest({ ...base, role: "stream-source" });

    expect(manifest?.role).toBe("stream-source");
  });

  it("refuses an unknown role", () => {
    const { manifest, errors } = parseManifest({ ...base, role: "plugin" });

    expect(manifest).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("is orthogonal to kinds", () => {
    const { manifest } = parseManifest({
      ...base,
      role: "stream-source",
      kinds: ["anime"],
    });

    expect(manifest?.role).toBe("stream-source");
    expect(manifest?.kinds).toEqual(["anime"]);
  });
});

describe("adapt", () => {
  it("applies the mapping", () => {
    expect(adapt({ n: 2 }, (raw) => raw.n * 3)).toBe(6);
  });

  it("drops records the mapping cannot honestly convert", () => {
    const out = adaptAll([{ id: "a" }, { id: "" }, { id: "b" }], (raw) =>
      raw.id.length > 0 ? raw.id : null,
    );

    expect(out).toEqual(["a", "b"]);
  });
});

describe("StreamSourceRegistry", () => {
  const source = (id: string) =>
    ({
      id,
      name: id,
      kinds: ["anime"],
      search: async () => [],
      getEpisodes: async () => [],
      getStreams: async () => [] as StreamResult[],
    }) as never;

  it("registers and resolves by id", () => {
    const registry = new StreamSourceRegistry();
    registry.register(source("ext-a"));

    expect(registry.get("ext-a")?.name).toBe("ext-a");
    expect(registry.all()).toHaveLength(1);
  });

  it("refuses a duplicate id", () => {
    const registry = new StreamSourceRegistry();
    registry.register(source("ext-a"));

    expect(() => registry.register(source("ext-a"))).toThrow(/already registered/);
  });

  it("refuses a source missing a method", () => {
    const registry = new StreamSourceRegistry();
    const broken = { id: "ext-b", name: "b", kinds: [], search: async () => [] } as never;

    expect(() => registry.register(broken)).toThrow(/getEpisodes/);
  });

  it("omits disabled sources from available()", () => {
    const registry = new StreamSourceRegistry();
    registry.register(source("ext-a"));
    registry.setEnabled("ext-a", false);

    expect(registry.available()).toHaveLength(0);
    expect(registry.all()).toHaveLength(1);
  });

  it("unregisters without complaint for an unknown id", () => {
    const registry = new StreamSourceRegistry();

    expect(registry.unregister("ext-missing")).toBe(false);
  });
});
