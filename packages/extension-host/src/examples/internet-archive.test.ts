import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { createQuickJSRuntime } from "../runtime/quickjs";
import { createBrokeredFetch } from "../net";
import { parseManifest } from "../manifest";
const folder = new URL(
  "../../../../extensions/internet-archive/",
  import.meta.url,
);
async function fixture(
  state: {
    dark?: boolean;
    restricted?: boolean;
    collection?: string;
    wrongId?: boolean;
    noFiles?: boolean;
    malformed?: boolean;
  } = {},
) {
  const manifest = parseManifest(
    JSON.parse(await readFile(new URL("manifest.json", folder), "utf8")),
  ).manifest!;
  const calls: URL[] = [];
  const broker = createBrokeredFetch(
    {
      extensionId: manifest.id,
      granted: manifest.permissions,
      allowedHosts: manifest.hosts,
      grantedForVersion: manifest.version,
      grantedAt: new Date().toISOString(),
    },
    {
      request: async (request) => {
        const url = new URL(request.url);
        calls.push(url);
        expect(url.hostname).toBe("archive.org");
        let data;
        if (url.pathname === "/advancedsearch.php") {
          const rows = Number(url.searchParams.get("rows")),
            page = Number(url.searchParams.get("page"));
          data = {
            response: {
              numFound: 100,
              docs: Array.from({ length: rows }, (_, index) => ({
                identifier: `film-${(page - 1) * rows + index}`,
                title: "Film",
                year: "1940-01-01",
              })),
            },
          };
        } else if (url.pathname === "/metadata/film-0")
          data = {
            is_dark: state.dark,
            metadata: {
              identifier: state.wrongId ? "other" : "film-0",
              mediatype: "movies",
              collection: state.collection ?? ["feature_films"],
              "access-restricted-item": state.restricted,
              language: "eng",
            },
            files: state.noFiles
              ? []
              : [
                  {
                    name: "film hd.mp4",
                    height: "1080",
                    size: "90000000",
                    length: "1800.5",
                  },
                  {
                    name: "film_512kb.mp4",
                    height: "240",
                    size: "10000000",
                    length: "00:30:00",
                  },
                  {
                    name: "private.mp4",
                    height: "2160",
                    size: "800000000",
                    private: "true",
                    length: "1800",
                  },
                  {
                    name: "film trailer.mp4",
                    height: "2160",
                    size: "90000000",
                    length: "120",
                  },
                  { name: "bonus.mp4", size: "90000000", length: "300" },
                  { name: "../escape.mp4", size: "90000000", length: "1800" },
                  { name: "film.asr.srt", size: "90000" },
                  { name: "private.srt", size: "90000", private: true },
                ],
          };
        else throw Error("Unexpected fixture request");
        return {
          status: 200,
          headers: {},
          body: state.malformed ? "<html>bad</html>" : JSON.stringify(data),
        };
      },
    },
  );
  if (!broker) throw Error("Missing fixture network grant");
  const loaded = await createQuickJSRuntime().load({
    extensionId: manifest.id,
    source: await readFile(new URL("index.js", folder), "utf8"),
    bridge: { extensionId: manifest.id, fetch: broker, log() {} },
  });
  return {
    manifest,
    calls,
    call: (method: string, ...args: unknown[]) =>
      loaded.call(method, args, AbortSignal.timeout(5000)),
    dispose: () => loaded.dispose(),
  };
}
describe("Internet Archive public feature-film source", () => {
  it("uses literal search, exact row counts and stable Popular/Latest pagination", async () => {
    const f = await fixture();
    try {
      const query = 'Friday" OR collection:private \\ test';
      const rows = (await f.call("search", query, {
        kind: "movie",
        limit: 14,
      })) as any[];
      expect(rows).toHaveLength(14);
      expect(rows[0].year).toBe(1940);
      expect(f.calls[0]!.searchParams.get("q")).toBe(
        'collection:feature_films AND mediatype:movies AND title:"Friday\\" OR collection:private \\\\ test"',
      );
      const page = (await f.call("browse", "popular", {
        kind: "movie",
        page: 2,
        limit: 14,
      })) as any;
      expect(page.items[0].id).toBe("film-14");
      expect(page.hasMore).toBe(true);
      await f.call("browse", "latest", { kind: "movie", page: 1, limit: 7 });
      expect(f.calls[2]!.searchParams.get("sort[]")).toBe("publicdate desc");
      expect(
        f.calls.every((url) => url.pathname === "/advancedsearch.php"),
      ).toBe(true);
    } finally {
      f.dispose();
    }
  });
  it("returns reported quality and captions, filters private/preview/unsafe files and caches metadata", async () => {
    const f = await fixture();
    try {
      const entries = (await f.call("getEpisodes", "film-0")) as any[];
      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe("film-0|feature");
      const streams = (await f.call("getStreams", entries[0].id)) as any[];
      expect(streams[0].videoSources.map((row: any) => row.quality)).toEqual([
        "1080p",
        "240p",
      ]);
      expect(streams[0].videoSources[0].url).toBe(
        "https://archive.org/download/film-0/film%20hd.mp4",
      );
      expect(streams[0].videoSources[0].subtitles).toEqual([
        {
          id: "archive-sub-0",
          url: "https://archive.org/download/film-0/film.asr.srt",
          language: "eng",
          title: "Auto-generated",
        },
      ]);
      expect(f.calls).toHaveLength(1);
      await expect(
        f.call("getStreams", entries[0].id, {
          excludeServers: ["Internet Archive"],
        }),
      ).rejects.toThrow(/untried/);
    } finally {
      f.dispose();
    }
  });
  it.each([
    { dark: true },
    { restricted: true },
    { collection: "other" },
    { wrongId: true },
    { noFiles: true },
    { malformed: true },
  ])(
    "refuses restricted, unrelated, empty or malformed item %o",
    async (state) => {
      const f = await fixture(state);
      try {
        await expect(f.call("getEpisodes", "film-0")).rejects.toThrow();
      } finally {
        f.dispose();
      }
    },
  );
  it("rejects invalid IDs and browsing options without making a request", async () => {
    const f = await fixture();
    try {
      for (const id of ["../private", "a/b", "x|feature", "bad\\name", "a..b"])
        await expect(f.call("getEpisodes", id)).rejects.toThrow(/Invalid/);
      await expect(f.call("getStreams", "film-0|season1")).rejects.toThrow(
        /Invalid/,
      );
      await expect(f.call("search", "Film", { kind: "tv" })).rejects.toThrow(
        /Movies only/,
      );
      await expect(
        f.call("browse", "ongoing", { page: 1, limit: 14 }),
      ).rejects.toThrow();
      await expect(
        f.call("browse", "popular", { page: 0, limit: 14 }),
      ).rejects.toThrow();
      expect(f.calls).toHaveLength(0);
      expect(f.manifest.hosts).toEqual(["archive.org"]);
      expect(f.manifest.permissions).toEqual(["network"]);
    } finally {
      f.dispose();
    }
  });
});
