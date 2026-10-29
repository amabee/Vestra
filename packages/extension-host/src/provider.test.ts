import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { canActAsProvider, createExtensionProvider } from "./provider";
import type { HostBridge } from "./runtime/engine";
import { createQuickJSRuntime } from "./runtime/quickjs";

/**
 * The join between a running isolate and the provider registry.
 *
 * Everything on either side was already tested — the sandbox holds, the
 * registry routes — but nothing exercised the seam, which is where the app
 * spent its whole life with a sandbox that nothing ever called.
 */

const EXAMPLE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../examples/open-library/index.js",
);

const RESPONSE = JSON.stringify({
  docs: [
    { key: "/works/OL893415W", title: "Dune", first_publish_year: 1965, cover_i: 8231583 },
    { key: "/works/OL27448W", title: "Dune Messiah", first_publish_year: 1969 },
    { nope: true },
  ],
});

function bridge(): HostBridge {
  return {
    extensionId: "example-open-library",
    log: () => undefined,
    fetch: async () => ({ status: 200, headers: {}, body: RESPONSE }),
  };
}

async function loadExample() {
  const runtime = createQuickJSRuntime();
  const source = await readFile(EXAMPLE, "utf8");

  return runtime.load({
    extensionId: "example-open-library",
    source,
    bridge: bridge(),
  });
}

describe("an extension as a provider", () => {
  it("reports the methods the extension actually exports", async () => {
    const loaded = await loadExample();

    try {
      const methods = await loaded.listMethods(AbortSignal.timeout(10_000));

      expect(methods).toContain("search");
      expect(methods).toContain("getDetails");
      expect(canActAsProvider(methods)).toBe(true);
    } finally {
      loaded.dispose();
    }
  }, 30_000);

  it("turns guest results into media items under a namespaced source", async () => {
    const loaded = await loadExample();

    try {
      const provider = createExtensionProvider({
        extensionId: "example-open-library",
        name: "Open Library Example",
        kinds: ["movie"],
        methods: ["search", "getDetails"],
        call: (method, args, signal) => loaded.call(method, args, signal),
      });

      const result = await provider.search!(
        { query: "dune", sources: [], kinds: [], page: 1, perPage: 5 },
        { signal: AbortSignal.timeout(10_000), timeoutMs: 10_000 },
      );

      expect(result.items).toHaveLength(2);

      const [first] = result.items;
      expect(first?.title).toBe("Dune");
      expect(first?.year).toBe(1965);

      // Namespaced, so it cannot be mistaken for a first-party provider and
      // cannot collide with one.
      expect(first?.source).toBe("ext-example-open-library");
      expect(provider.id).toBe("ext-example-open-library");

      // The id the extension gave is preserved, because getDetails is called
      // back with it.
      expect(first?.sourceId).toBe("/works/OL893415W");
    } finally {
      loaded.dispose();
    }
  }, 30_000);

  it("drops results that do not satisfy the contract", async () => {
    const loaded = await loadExample();
    const warnings: string[] = [];

    try {
      const provider = createExtensionProvider({
        extensionId: "example-open-library",
        name: "Open Library Example",
        kinds: ["movie"],
        methods: ["search"],
        call: (method, args, signal) => loaded.call(method, args, signal),
        onWarning: (message) => warnings.push(message),
      });

      const result = await provider.search!(
        { query: "dune", sources: [], kinds: [], page: 1, perPage: 5 },
        { signal: AbortSignal.timeout(10_000), timeoutMs: 10_000 },
      );

      // The third doc in the fixture is malformed. The extension drops it
      // before we see it, so two arrive and nothing is reported.
      expect(result.items).toHaveLength(2);
      expect(warnings).toEqual([]);
    } finally {
      loaded.dispose();
    }
  }, 30_000);

  it("advertises only what the extension can do", () => {
    const provider = createExtensionProvider({
      extensionId: "search-only",
      name: "Search Only",
      kinds: ["anime"],
      methods: ["search"],
      call: async () => [],
    });

    expect(provider.capabilities.search).toBe(true);
    expect(provider.capabilities.details).toBe(false);
    expect(provider.capabilities.trending).toBe(false);
  });

  it("routes an optional trending method", async () => {
    const provider = createExtensionProvider({
      extensionId: "trending-source",
      name: "Trending Source",
      kinds: ["anime"],
      methods: ["search", "getTrending"],
      call: async (method) =>
        method === "getTrending"
          ? [
              {
                id: "title-1",
                title: "Example Anime",
                year: null,
                poster: null,
                description: "",
                isSeries: true,
              },
            ]
          : [],
    });

    expect(provider.capabilities.trending).toBe(true);

    const items = await provider.getTrending!("anime", {
      signal: AbortSignal.timeout(10_000),
      timeoutMs: 10_000,
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe("ext-trending-source");
  });

  it("will not act as a provider without a search method", () => {
    expect(canActAsProvider([])).toBe(false);
    expect(canActAsProvider(["getDetails"])).toBe(false);
    expect(canActAsProvider(["search"])).toBe(true);
  });
});
