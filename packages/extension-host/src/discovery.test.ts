import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseManifest } from "./manifest";
import { createStreamSourceProvider } from "./provider";
import { createQuickJSRuntime } from "./runtime/quickjs";

describe("native discovery contract", () => {
  it("loads the authoring template in real QuickJS and preserves title identity into episodes", async () => {
    const manifest = parseManifest(
      JSON.parse(
        await readFile(
          new URL(
            "../examples/stream-source-template/manifest.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    ).manifest!;
    const runtime = createQuickJSRuntime();
    const loaded = await runtime.load({
      extensionId: manifest.id,
      source: await readFile(
        new URL("../examples/stream-source-template/index.js", import.meta.url),
        "utf8",
      ),
      bridge: { extensionId: manifest.id, log() {} },
    });
    try {
      const provider = createStreamSourceProvider({
        extensionId: manifest.id,
        name: manifest.name,
        kinds: manifest.kinds,
        browseCategories: manifest.discovery!.categories,
        methods: await loaded.listMethods(AbortSignal.timeout(5000)),
        call: (method, args, signal) => loaded.call(method, args, signal),
      });
      const page = await provider.browse!("suggested", { page: 1, limit: 24 });
      expect(page.items).toHaveLength(2);
      expect(page.hasMore).toBe(false);
      expect(page.items[0]!.provider).toBe(provider.id);
      const episodes = await provider.getEpisodes(page.items[0]!.id);
      expect(episodes[0]!.animeId).toBe(page.items[0]!.id);
      expect(
        (await provider.browse!("suggested", { page: 2, limit: 24 })).items,
      ).toEqual([]);
      await expect(
        provider.browse!("ongoing", { page: 1, limit: 24 }),
      ).rejects.toThrow("category");
    } finally {
      runtime.disposeAll();
    }
  });
  it("keeps old extensions valid and requires an implementation for declared feeds", () => {
    const options = {
      extensionId: "old",
      name: "Old",
      kinds: ["anime" as const],
      methods: ["search", "getEpisodes", "getStreams"],
      call: async () => [],
    };
    expect(createStreamSourceProvider(options).browse).toBeUndefined();
    expect(() =>
      createStreamSourceProvider({
        ...options,
        browseCategories: ["suggested"],
      }),
    ).toThrow("browse()");
    const base = {
      id: "fixture",
      name: "Fixture",
      version: "1",
      sdkVersion: "1.2.0",
      main: "index.js",
      role: "stream-source",
      kinds: ["anime"],
    };
    expect(
      parseManifest({
        ...base,
        discovery: { categories: ["latest", "latest"] },
      }).manifest,
    ).toBeNull();
    expect(
      parseManifest({
        ...base,
        role: "metadata",
        discovery: { categories: ["latest"] },
      }).manifest,
    ).toBeNull();
  });
  it.each([
    null,
    { items: [], hasMore: "yes" },
    {
      items: [{ id: "one", title: "One", cover: "http://unsafe.example/a" }],
      hasMore: false,
    },
    {
      items: [
        { id: "one", title: "One" },
        { id: "one", title: "Duplicate" },
      ],
      hasMore: false,
    },
    {
      items: Array.from({ length: 25 }, (_, i) => ({
        id: String(i),
        title: "Too many",
      })),
      hasMore: false,
    },
  ])("rejects malformed discovery results: %j", async (raw) => {
    const provider = createStreamSourceProvider({
      extensionId: "fixture",
      name: "Fixture",
      kinds: ["anime"],
      methods: ["search", "getEpisodes", "getStreams", "browse"],
      browseCategories: ["latest"],
      call: async () => raw,
    });
    await expect(
      provider.browse!("latest", { page: 1, limit: 24 }),
    ).rejects.toThrow();
  });
});
