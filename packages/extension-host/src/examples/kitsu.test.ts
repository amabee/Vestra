import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseDetails, parseSearchResults } from "../contract";
import { parseManifest } from "../manifest";
import { createExtensionProvider } from "../provider";
import type { HostBridge } from "../runtime/engine";
import { createQuickJSRuntime } from "../runtime/quickjs";

/**
 * The reference provider, run in the isolate against recorded Kitsu payloads.
 *
 * Recorded rather than live: a test that reaches the network fails when a
 * third party is slow, which teaches everyone to ignore it. The shapes below
 * are trimmed copies of real responses.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FOLDER = path.join(HERE, "../../examples/kitsu");

const SEARCH_RESPONSE = JSON.stringify({
  data: [
    {
      id: "46474",
      attributes: {
        canonicalTitle: "Sousou no Frieren",
        startDate: "2023-09-29",
        synopsis: "The story follows the elf mage Frieren.",
        subtype: "TV",
        posterImage: {
          medium: "https://media.kitsu.app/anime/46474/poster_image/medium.jpeg",
        },
      },
    },
    {
      id: "49240",
      attributes: {
        canonicalTitle: "Sousou no Frieren 2nd Season",
        startDate: "2026-01-16",
        synopsis: "",
        subtype: "TV",
        // No poster at all — must not become an invalid URL.
        posterImage: null,
      },
    },
    // Missing a title: dropped by the extension before the host sees it.
    { id: "1", attributes: {} },
  ],
});

const DETAILS_RESPONSE = JSON.stringify({
  data: {
    id: "46474",
    attributes: {
      canonicalTitle: "Sousou no Frieren",
      startDate: "2023-09-29",
      synopsis: "The story follows the elf mage Frieren.",
      subtype: "TV",
      posterImage: { medium: "https://media.kitsu.app/anime/46474/poster_image/medium.jpeg" },
      episodeCount: 28,
      averageRating: "88.8",
    },
  },
});

const CATEGORIES_RESPONSE = JSON.stringify({
  data: [
    { attributes: { title: "Adventure" } },
    { attributes: { title: "Fantasy" } },
    { attributes: { nope: true } },
  ],
});

/** Answers by URL, so the extension's own request shaping is exercised. */
function bridge(seen: string[] = []): HostBridge {
  return {
    extensionId: "example-kitsu",
    log: () => undefined,
    fetch: async ({ url }) => {
      seen.push(url);

      const body = url.includes("/categories")
        ? CATEGORIES_RESPONSE
        : /\/anime\/\d+\?/.test(url)
          ? DETAILS_RESPONSE
          : SEARCH_RESPONSE;

      return { status: 200, headers: {}, body };
    },
  };
}

async function load(host: HostBridge = bridge()) {
  const runtime = createQuickJSRuntime();
  const source = await readFile(path.join(FOLDER, "index.js"), "utf8");

  return runtime.load({ extensionId: "example-kitsu", source, bridge: host });
}

describe("the Kitsu reference extension", () => {
  it("ships a manifest Vestra accepts", async () => {
    const raw: unknown = JSON.parse(
      await readFile(path.join(FOLDER, "manifest.json"), "utf8"),
    );

    const { manifest, errors } = parseManifest(raw);

    expect(errors).toEqual([]);
    expect(manifest?.id).toBe("example-kitsu");
    // Both are what make it a usable provider rather than merely loadable.
    expect(manifest?.kinds).toEqual(["anime"]);
    expect(manifest?.permissions).toEqual(["network"]);
    expect(manifest?.hosts).toEqual(["kitsu.io"]);
  });

  it("returns results that satisfy the contract", async () => {
    const loaded = await load();

    try {
      const raw = await loaded.call("search", ["frieren", { limit: 5 }], AbortSignal.timeout(10_000));
      const { value, errors } = parseSearchResults(raw);

      expect(errors).toEqual([]);
      expect(value?.map((item) => item.title)).toEqual([
        "Sousou no Frieren",
        "Sousou no Frieren 2nd Season",
      ]);
      expect(value?.[0]?.year).toBe(2023);
      expect(value?.[0]?.isSeries).toBe(true);
      // The entry with no poster must be null, not a broken URL.
      expect(value?.[1]?.poster).toBeNull();
    } finally {
      loaded.dispose();
    }
  }, 30_000);

  it("asks Kitsu only for the fields it uses", async () => {
    const seen: string[] = [];
    const loaded = await load(bridge(seen));

    try {
      await loaded.call("search", ["frieren", { limit: 5 }], AbortSignal.timeout(10_000));

      expect(seen[0]).toContain("filter%5Btext%5D=frieren");
      expect(seen[0]).toContain("fields%5Banime%5D=");
    } finally {
      loaded.dispose();
    }
  }, 30_000);

  it("caps the page size Kitsu will accept", async () => {
    const seen: string[] = [];
    const loaded = await load(bridge(seen));

    try {
      // Kitsu errors above 20, so asking for more must not be passed through.
      await loaded.call("search", ["frieren", { limit: 500 }], AbortSignal.timeout(10_000));

      expect(seen[0]).toContain("page%5Blimit%5D=20");
    } finally {
      loaded.dispose();
    }
  }, 30_000);

  it("returns details with genres and a rating", async () => {
    const loaded = await load();

    try {
      const raw = await loaded.call("getDetails", ["46474"], AbortSignal.timeout(10_000));
      const { value, errors } = parseDetails(raw);

      expect(errors).toEqual([]);
      expect(value?.title).toBe("Sousou no Frieren");
      expect(value?.episodeCount).toBe(28);
      expect(value?.rating).toBeCloseTo(88.8);
      // The malformed third category is dropped, not rendered as undefined.
      expect(value?.genres).toEqual(["Adventure", "Fantasy"]);
    } finally {
      loaded.dispose();
    }
  }, 30_000);

  it("refuses an id it could not have produced", async () => {
    const loaded = await load();

    try {
      for (const id of ["../../etc/passwd", "1; DROP", ""]) {
        const raw = await loaded.call("getDetails", [id], AbortSignal.timeout(10_000));
        expect(raw, id).toBeNull();
      }
    } finally {
      loaded.dispose();
    }
  }, 30_000);

  it("becomes media items under its own namespaced source", async () => {
    const loaded = await load();

    try {
      const provider = createExtensionProvider({
        extensionId: "example-kitsu",
        name: "Kitsu",
        kinds: ["anime"],
        methods: ["search", "getDetails"],
        call: (method, args, signal) => loaded.call(method, args, signal),
      });

      const result = await provider.search!(
        { query: "frieren", sources: [], kinds: [], page: 1, perPage: 5 },
        { signal: AbortSignal.timeout(10_000), timeoutMs: 10_000 },
      );

      expect(result.items[0]?.source).toBe("ext-example-kitsu");
      expect(result.items[0]?.kind).toBe("anime");
      expect(result.items[0]?.sourceId).toBe("46474");
    } finally {
      loaded.dispose();
    }
  }, 30_000);
});
