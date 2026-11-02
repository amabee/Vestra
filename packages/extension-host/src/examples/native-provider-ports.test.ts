import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { createQuickJSRuntime } from "../runtime/quickjs";
import { createBrokeredFetch } from "../net";
import { parseManifest } from "../manifest";
import { parseStreamResults } from "../stream-types";

async function fixture(
  name: "vidlink" | "streamflix" | "desiflix",
  respond: (url: URL) => unknown,
  status = 200,
) {
  const folder = new URL(`../../../../extensions/${name}/`, import.meta.url);
  const parsed = parseManifest(
    JSON.parse(await readFile(new URL("manifest.json", folder), "utf8")),
  );
  expect(parsed.errors).toEqual([]);
  const manifest = parsed.manifest!;
  const calls: URL[] = [];
  const fetch = createBrokeredFetch(
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
        expect(url.searchParams.has("api_key")).toBe(false);
        expect(request.headers.authorization).toBeUndefined();
        return {
          status,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(respond(url)),
        };
      },
    },
  );
  if (!fetch) throw Error("Provider fixture needs network access");
  const runtime = await createQuickJSRuntime().load({
    extensionId: manifest.id,
    source: await readFile(new URL("index.js", folder), "utf8"),
    bridge: { extensionId: manifest.id, fetch, log() {} },
  });
  return {
    calls,
    call: (method: string, ...args: unknown[]) =>
      runtime.call(method, args, AbortSignal.timeout(5000)),
    dispose: () => runtime.dispose(),
  };
}
const movie = (n = 1) => ({
  isTV: false,
  moviekey: `chilflix-${n}`,
  moviename: `Film ${n}`,
  movieyear: "2024",
  movieviews: n,
  movielink: `movies/2024/film${n}.mkv`,
  movieposter: "poster.jpg",
});
describe("native provider ports", () => {
  it("DesiFlix searches IMDb metadata without a key and caches bounded results", async () => {
    const f = await fixture("desiflix", () => ({
      metas: [
        {
          id: "tt0111161",
          type: "movie",
          name: "The Shawshank Redemption",
          releaseInfo: "1994",
          poster: "https://images.metahub.space/poster/medium/tt0111161/img",
        },
        { id: "tt0111161", type: "movie", name: "Duplicate" },
        { id: "tt0903747", type: "series", name: "Wrong kind" },
        { id: "../bad", type: "movie", name: "Bad identity" },
      ],
    }));
    try {
      expect(
        await f.call("search", "Shawshank", { kind: "movie", limit: 5 }),
      ).toEqual([
        {
          id: "movie|tt0111161",
          kind: "movie",
          title: "The Shawshank Redemption",
          year: 1994,
          cover: "https://images.metahub.space/poster/medium/tt0111161/img",
        },
      ]);
      await f.call("search", "Shawshank", { kind: "movie", limit: 5 });
      expect(f.calls).toHaveLength(1);
      await expect(
        f.call("search", "title", { kind: "anime" }),
      ).rejects.toThrow(/Choose/);
    } finally {
      f.dispose();
    }
  });
  it("DesiFlix preserves aired specials and exact season/episode mapping", async () => {
    const f = await fixture("desiflix", () => ({
      meta: {
        id: "tt0903747",
        type: "series",
        videos: [
          { season: 0, episode: 1, name: "Special", released: "2007-01-01" },
          { season: 1, episode: 1, name: "Pilot", released: "2008-01-01" },
          { season: 1, episode: 1, name: "Duplicate", released: "2008-01-01" },
          { season: 2, episode: 1, released: "2099-01-01" },
          { season: 3, episode: 1 },
          { season: -1, episode: 1, released: "2008-01-01" },
        ],
      },
    }));
    try {
      expect(await f.call("getEpisodes", "tv|tt0903747")).toEqual([
        {
          id: "tv|tt0903747|s0|e1",
          animeId: "tv|tt0903747",
          season: 0,
          number: 1,
          title: "Special",
        },
        {
          id: "tv|tt0903747|s1|e1",
          animeId: "tv|tt0903747",
          season: 1,
          number: 1,
          title: "Pilot",
        },
      ]);
      await expect(f.call("getStreams", "tv|tt0903747|s2|e1")).rejects.toThrow(
        /not aired/,
      );
      expect(f.calls).toHaveLength(1);
      await expect(f.call("getEpisodes", "movie|../tt0111161")).rejects.toThrow(
        /Invalid/,
      );
    } finally {
      f.dispose();
    }
  });
  it("DesiFlix maps direct files and metadata quality, rejects torrents/embeds, and excludes attempted mirrors", async () => {
    const f = await fixture("desiflix", () => ({
      streams: [
        {
          url: "https://media.example/film.mkv",
          behaviorHints: { filename: "Film.1080p.mkv" },
        },
        { url: "https://media.example/film.mp4", title: "720p" },
        { url: "https://media.example/master.m3u8" },
        { infoHash: "abc", url: "magnet:?xt=abc" },
        { url: "https://media.example/embed/film" },
        { url: "http://127.0.0.1/film.mp4" },
        { url: "https://media.example/film.mkv" },
      ],
    }));
    try {
      expect(await f.call("getEpisodes", "movie|tt0111161")).toMatchObject([
        { id: "movie|tt0111161|s0|e0" },
      ]);
      const result = parseStreamResults(
        await f.call("getStreams", "movie|tt0111161|s0|e0"),
      );
      expect(result.errors).toEqual([]);
      expect(
        result.value!.map((row) => [
          row.videoSources[0]!.type,
          row.videoSources[0]!.quality,
        ]),
      ).toEqual([
        ["mkv", "1080p"],
        ["mp4", "720p"],
        ["hls", "auto"],
      ]);
      expect(
        await f.call("getStreams", "movie|tt0111161|s0|e0", {
          excludeServers: ["DesiFlix · 1"],
        }),
      ).toHaveLength(2);
      // Duplicate URL cannot reappear under a second label after exclusion.
      expect(
        f.calls.every((url) => url.pathname === "/stream/movie/tt0111161.json"),
      ).toBe(true);
    } finally {
      f.dispose();
    }
  });
  it("DesiFlix refuses metadata identity substitution", async () => {
    const f = await fixture("desiflix", () => ({
      meta: { id: "tt0111161", type: "series", videos: [] },
    }));
    try {
      await expect(f.call("getEpisodes", "tv|tt0903747")).rejects.toThrow(
        /different title/,
      );
    } finally {
      f.dispose();
    }
  });
  it("StreamFlix bounds discovery, preserves stable pages, strips invalid/TV rows and caches", async () => {
    const f = await fixture("streamflix", () => ({
      data: [
        ...Array.from({ length: 21 }, (_, i) => movie(i + 1)),
        movie(),
        { ...movie(22), isTV: true },
        { ...movie(23), movielink: "movies/../../secret.mkv" },
      ],
    }));
    try {
      const first = (await f.call("browse", "popular", {
        kind: "movie",
        page: 1,
        limit: 14,
      })) as any;
      const second = (await f.call("browse", "popular", {
        kind: "movie",
        page: 2,
        limit: 14,
      })) as any;
      expect(first.items).toHaveLength(14);
      expect(first.hasMore).toBe(true);
      expect(second.items).toHaveLength(7);
      expect(second.hasMore).toBe(false);
      expect(
        first.items.some((a: any) =>
          second.items.some((b: any) => a.id === b.id),
        ),
      ).toBe(false);
      expect(
        await f.call("search", "Film 21", { kind: "movie", limit: 5 }),
      ).toMatchObject([{ id: "chilflix-21", kind: "movie" }]);
      expect(f.calls).toHaveLength(1);
      await expect(
        f.call("browse", "popular", { kind: "movie", page: 0 }),
      ).rejects.toThrow(/Invalid/);
      await expect(f.call("search", "film", { kind: "tv" })).rejects.toThrow(
        /movies/,
      );
    } finally {
      f.dispose();
    }
  });
  it("StreamFlix only builds configured exact mirrors and labels MKV honestly", async () => {
    const f = await fixture("streamflix", (url) =>
      url.pathname === "/data.json"
        ? { data: [movie()] }
        : {
            movies: [
              "https://evil.example/",
              "https://bb.streamflixserver.site/file/streamflix/",
            ],
            premium: [
              "https://s3.ap-southeast-1.wasabisys.com/streamflix/",
              "https://s3.ap-southeast-1.wasabisys.com/streamflix/",
            ],
          },
    );
    try {
      expect(await f.call("getEpisodes", "chilflix-1")).toMatchObject([
        { id: "chilflix-1|feature" },
      ]);
      const raw = await f.call("getStreams", "chilflix-1|feature");
      const result = parseStreamResults(raw);
      expect(result.errors).toEqual([]);
      expect(result.value).toHaveLength(2);
      expect(result.value![0]!.videoSources[0]).toMatchObject({
        type: "mkv",
        quality: "auto",
      });
      expect(JSON.stringify(result.value)).not.toContain("evil.example");
      await expect(f.call("getStreams", "../x|feature")).rejects.toThrow(
        /Invalid/,
      );
      await expect(
        f.call("getStreams", "chilflix-1|feature", {
          excludeServers: ["StreamFlix · 1", "StreamFlix · 3"],
        }),
      ).rejects.toThrow(/untried/);
    } finally {
      f.dispose();
    }
  });
  it("Vidlink preserves master audio/subtitles and uses canonical IDs with an encoded helper result", async () => {
    const f = await fixture("vidlink", (url) =>
      url.hostname === "enc-dec.app"
        ? { result: "abc+/==" }
        : {
            stream: {
              playlist: "https://media.example/master.m3u8",
              qualities: {
                1080: { url: "https://media.example/video-only.mp4" },
              },
            },
            subtitles: [
              {
                url: "https://subs.example/en.vtt",
                language: "en",
                label: "English",
              },
              { url: "http://127.0.0.1/a.srt" },
            ],
          },
    );
    try {
      expect(
        await f.call("matchCatalogue", ["movie|278", "tv|1396", "movie|278"]),
      ).toEqual(["movie|278", "tv|1396"]);
      const hints = [
        {
          id: "tv|1396|s0|e1",
          animeId: "tv|1396",
          season: 0,
          number: 1,
          title: "Special",
        },
        { id: "tv|1396|s1|e1", animeId: "tv|1396", season: 1, number: 1 },
        { id: "tv|1396|s1|e1", animeId: "tv|1396", season: 1, number: 1 },
        { id: "tv|999|s1|e1", animeId: "tv|1396", season: 1, number: 1 },
      ];
      expect(await f.call("getEpisodes", "tv|1396", hints)).toHaveLength(2);
      const raw = await f.call("getStreams", "tv|1396|s0|e1");
      const result = parseStreamResults(raw);
      expect(result.errors).toEqual([]);
      expect(result.value![0]!.videoSources).toHaveLength(1);
      expect(result.value![0]!.videoSources[0]).toMatchObject({
        type: "hls",
        quality: "auto",
        subtitles: [{ id: "vidlink-sub-0", language: "en" }],
      });
      expect(f.calls[1]!.pathname).toBe("/api/b/tv/abc%2B%2F%3D%3D/0/1");
      const count = f.calls.length;
      await expect(f.call("getStreams", "movie|../278|s0|e0")).rejects.toThrow(
        /Invalid/,
      );
      await expect(f.call("getStreams", "movie|278|s1|e1")).rejects.toThrow(
        /Invalid/,
      );
      await expect(
        f.call("getStreams", "tv|1396|s1|e1", { excludeServers: ["Vidlink"] }),
      ).rejects.toThrow(/untried/);
      expect(f.calls).toHaveLength(count);
    } finally {
      f.dispose();
    }
  });
  it.each([
    "http://media.example/movie.mp4",
    "https://127.0.0.1/movie.mp4",
    "https://user:pass@media.example/movie.mp4",
    "https://media.example/embed/278",
    "https://media.local/movie.mp4",
  ])("Vidlink refuses unsafe or embed media %s", async (url) => {
    const f = await fixture("vidlink", (u) =>
      u.hostname === "enc-dec.app" ? { result: "encoded" } : { url },
    );
    try {
      await expect(f.call("getStreams", "movie|278|s0|e0")).rejects.toThrow(
        /no native/,
      );
    } finally {
      f.dispose();
    }
  });
  it("fails upstream errors explicitly without guessed links or endless retries", async () => {
    for (const name of ["streamflix", "vidlink"] as const) {
      const f = await fixture(name, () => ({}), 403);
      try {
        await expect(
          f.call(
            "getStreams",
            name === "streamflix" ? "chilflix-1|feature" : "movie|278|s0|e0",
          ),
        ).rejects.toThrow(/403/);
        expect(f.calls).toHaveLength(1);
      } finally {
        f.dispose();
      }
    }
  });
});
