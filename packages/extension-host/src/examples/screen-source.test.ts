import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createQuickJSRuntime } from "../runtime/quickjs";
import { createStreamSourceProvider } from "../provider";
import { parseManifest } from "../manifest";

describe("Movies/TV reference extension", () => {
  it("runs in the real isolate with kind filters, seasons and validated streams", async () => {
    const folder = new URL(
      "../../examples/screen-source-template/",
      import.meta.url,
    );
    const manifest = parseManifest(
      JSON.parse(await readFile(new URL("manifest.json", folder), "utf8")),
    );
    expect(manifest.errors).toEqual([]);
    expect(manifest.manifest?.sdkVersion).toBe("1.3.0");
    const runtime = createQuickJSRuntime();
    const loaded = await runtime.load({
      extensionId: "example-screen-source",
      source: await readFile(new URL("index.js", folder), "utf8"),
      bridge: {
        extensionId: "example-screen-source",
        log() {},
        fetch: async () => {
          throw Error("Template must not access the network");
        },
      },
    });
    try {
      const provider = createStreamSourceProvider({
        extensionId: "example-screen-source",
        name: "Screen template",
        kinds: ["movie", "tv"],
        methods: ["search", "browse", "getEpisodes", "getStreams"],
        browseCategories: ["popular", "latest"],
        call: (method, args, signal) => loaded.call(method, [...args], signal),
      });
      const films = await provider.search("Example", { kind: "movie" });
      expect(films.map((row) => row.kind)).toEqual(["movie"]);
      const series = await provider.browse!("popular", {
        kind: "tv",
        page: 1,
        limit: 24,
      });
      expect(series.items.map((row) => row.kind)).toEqual(["tv"]);
      const episodes = await provider.getEpisodes(series.items[0]!.id);
      expect(episodes.map((row) => row.season)).toEqual([0, 1, 1, 2]);
      expect(await provider.getEpisodes(films[0]!.id)).toHaveLength(1);
      expect(
        (await provider.getStreams(episodes[0]!.id))[0]!.videoSources[0]!.type,
      ).toBe("mp4");
      expect(await provider.getStreams("unknown")).toEqual([]);
    } finally {
      loaded.dispose();
    }
  });
});
