import { readFile } from "node:fs/promises";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createQuickJSRuntime } from "../runtime/quickjs";
import { createStreamSourceProvider } from "../provider";
import { createBrokeredFetch } from "../net";
import { parseManifest } from "../manifest";

const folder = new URL("../../../../extensions/kisskh/", import.meta.url);
const KEY = Buffer.from("4f6bdaa39e2f8cb07f5e722d9edef314", "hex");
const IV = Buffer.from("01504af356e619cf2e42bba68c3f70f9", "hex");
type State = {
  videoType?: number;
  videoUrl?: string;
  subtitleFailure?: boolean;
  wrongKind?: boolean;
  badPagination?: boolean;
};
async function fixture(state: State = {}) {
  const manifest = parseManifest(
    JSON.parse(await readFile(new URL("manifest.json", folder), "utf8")),
  ).manifest!;
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const fetcher = createBrokeredFetch(
    {
      extensionId: manifest.id,
      granted: manifest.permissions,
      allowedHosts: manifest.hosts,
      grantedForVersion: manifest.version,
      grantedAt: new Date().toISOString(),
    },
    {
      request: async (
        input,
      ): Promise<{
        status: number;
        headers: Record<string, string>;
        body: string;
      }> => {
        const url = new URL(input.url);
        calls.push({ url, headers: input.headers });
        expect(input.headers.referer).toBe("https://kisskh.co/");
        const movie = url.searchParams.get("type") === "2";
        const row = {
          id: movie ? 56 : 26,
          title: movie ? "Sample movie" : "Sample drama",
          episodesCount: movie ? 1 : 16,
          thumbnail: "https://media.themoviedb.org/image.jpg",
        };
        let data: unknown;
        if (url.pathname.endsWith("/Search"))
          data = [
            row,
            row,
            { ...row, id: -1 },
            { ...row, id: "invalid" },
            { ...row, id: true },
          ];
        else if (url.pathname.endsWith("/List"))
          data = state.badPagination
            ? { data: [], pageSize: 0 }
            : {
                page: Number(url.searchParams.get("page")),
                pageSize: 20,
                totalCount: 21,
                data: [row],
              };
        else if (url.pathname.includes("/Drama/")) {
          const isMovie = url.pathname.endsWith("/56");
          data = {
            id: isMovie ? 56 : 26,
            title: isMovie ? "Sample movie" : "Sample drama",
            type: state.wrongKind ? "Anime" : isMovie ? "Movie" : "TVSeries",
            releaseDate: "2021-08-21T13:30:09",
            episodes: isMovie
              ? [{ id: 500, number: 1 }]
              : [
                  { id: 306, number: 16 },
                  { id: 302, number: 13.5 },
                  { id: 305, number: 1 },
                  { id: 305, number: 1 },
                  { id: -1, number: 2 },
                ],
          };
        } else if (url.pathname.includes("/Episode/"))
          data = {
            id: null,
            Type: state.videoType ?? 0,
            Video:
              state.videoUrl ??
              "https://hls03.videocdndelivery05.site/direct.mp4",
            ThirdParty: "https://example.com/embed/ignored",
          };
        else if (url.pathname.includes("/Sub/")) {
          if (state.subtitleFailure) throw Error("Subtitles offline");
          data = [
            {
              src: "https://sub.cdnvideo11.shop/english.srt",
              label: "English",
              land: "en",
              default: true,
            },
            {
              src: "https://sub.cdnvideo11.shop/encrypted.txt",
              label: "Encrypted",
            },
            { src: "http://example.com/insecure.srt", label: "Insecure" },
          ];
        } else throw Error("Unexpected request");
        return { status: 200, headers: {}, body: JSON.stringify(data) };
      },
    },
  );
  const loaded = await createQuickJSRuntime().load({
    extensionId: manifest.id,
    source: await readFile(new URL("index.js", folder), "utf8"),
    bridge: { extensionId: manifest.id, fetch: fetcher!, log() {} },
  });
  const source = createStreamSourceProvider({
    extensionId: manifest.id,
    name: manifest.name,
    kinds: manifest.kinds,
    methods: await loaded.listMethods(AbortSignal.timeout(1000)),
    browseCategories: manifest.discovery!.categories,
    call: (method, args, signal) => loaded.call(method, [...args], signal),
  });
  return { source, loaded, calls };
}
describe("native KissKH extension in the actual isolate and permission broker", () => {
  it("uses source-owned kind filters and stable IDs without mistaking upload dates for release years", async () => {
    const f = await fixture();
    try {
      const tv = await f.source.search("Sample & drama", { kind: "tv" });
      expect(tv).toHaveLength(1);
      expect(tv[0]).toMatchObject({ id: "tv|26", kind: "tv" });
      expect(tv[0]).not.toHaveProperty("year");
      expect(f.calls[0]!.url.searchParams.get("q")).toBe("Sample & drama");
      expect(f.calls[0]!.url.searchParams.get("type")).toBe("1");
      expect((await f.source.search("Sample", { kind: "movie" }))[0]!.id).toBe(
        "movie|56",
      );
      expect(
        f.calls.some((row) => row.url.pathname.includes("/Episode/")),
      ).toBe(false);
    } finally {
      f.loaded.dispose();
    }
  });
  it("maps Popular, Latest, Ongoing, Upcoming and real pagination to the published source filters", async () => {
    const f = await fixture();
    try {
      for (const [category, order, status] of [
        ["popular", "1", "0"],
        ["latest", "2", "0"],
        ["ongoing", "2", "1"],
        ["upcoming", "2", "3"],
      ] as const) {
        const page = await f.source.browse!(category, {
          kind: "tv",
          page: 1,
          limit: 24,
        });
        expect(page.hasMore).toBe(true);
        expect(f.calls.at(-1)!.url.searchParams.get("order")).toBe(order);
        expect(f.calls.at(-1)!.url.searchParams.get("status")).toBe(status);
      }
      expect(
        (
          await f.source.browse!("popular", {
            kind: "movie",
            page: 2,
            limit: 24,
          })
        ).hasMore,
      ).toBe(false);
    } finally {
      f.loaded.dispose();
    }
  });
  it("retains fractional episode labels and source IDs without inventing a season, and caches detail lookup", async () => {
    const f = await fixture();
    try {
      const rows = await f.source.getEpisodes("tv|26");
      expect(rows.map((row) => row.number)).toEqual([1, 13.5, 16]);
      expect(rows.map((row) => row.id)).toEqual([
        "tv|26|305",
        "tv|26|302",
        "tv|26|306",
      ]);
      expect(rows[0]).not.toHaveProperty("season");
      await f.source.getEpisodes("tv|26");
      expect(
        f.calls.filter((row) => row.url.pathname.includes("/Drama/")),
      ).toHaveLength(1);
      expect(await f.source.getEpisodes("movie|56")).toHaveLength(1);
    } finally {
      f.loaded.dispose();
    }
  });
  it("reconstructs both observed public request-key vectors using independent Node AES validation", async () => {
    const f = await fixture();
    try {
      await f.source.getStreams("tv|26|305");
      for (const [part, checksum, guid] of [
        ["/Episode/", "1732006088", "62f176f3bb1b5b8e70e39932ad34a0c7"],
        ["/Sub/", "-13944436899", "VgV52sWhwvBSf8BsM3BRY9weWiiCbtGp"],
      ]) {
        const token = f.calls
          .find((row) => row.url.pathname.includes(part!))!
          .url.searchParams.get("kkey")!;
        const expected = `|${checksum}|305||mg3c3b04ba|2.8.10|${guid}|4830201|kisskh|kisskh|kisskh|kisskh|kisskh|kisskh|00|`;
        const cipher = createCipheriv("aes-128-cbc", KEY, IV);
        expect(token).toBe(
          Buffer.concat([cipher.update(expected), cipher.final()])
            .toString("hex")
            .toUpperCase(),
        );
        const decipher = createDecipheriv("aes-128-cbc", KEY, IV);
        expect(
          Buffer.concat([
            decipher.update(Buffer.from(token, "hex")),
            decipher.final(),
          ]).toString(),
        ).toBe(expected);
      }
    } finally {
      f.loaded.dispose();
    }
  });
  it("honors the source HLS type even when the URL ends in mp4 and returns plain subtitle tracks", async () => {
    const f = await fixture({ videoType: 1 });
    try {
      const result = await f.source.getStreams("tv|26|305");
      expect(result[0]!.videoSources[0]).toMatchObject({
        type: "hls",
        quality: "auto",
        subtitles: [{ language: "en", isDefault: true }],
      });
      expect(result[0]!.videoSources[0]!.subtitles).toHaveLength(1);
    } finally {
      f.loaded.dispose();
    }
  });
  it("keeps direct video playable when captions fail", async () => {
    const f = await fixture({ subtitleFailure: true });
    try {
      expect(
        (await f.source.getStreams("tv|26|305"))[0]!.videoSources[0]!.type,
      ).toBe("mp4");
    } finally {
      f.loaded.dispose();
    }
  });
  it("rejects foreign episodes, malformed identities, wrong title kinds and invalid pagination", async () => {
    const f = await fixture();
    try {
      await expect(f.source.getStreams("tv|26|999")).rejects.toThrow(/belong/);
      await expect(f.source.getEpisodes("tv|..\/26")).rejects.toThrow(
        /Invalid/,
      );
    } finally {
      f.loaded.dispose();
    }
    const wrong = await fixture({ wrongKind: true });
    try {
      await expect(wrong.source.getEpisodes("tv|26")).rejects.toThrow(/type/);
    } finally {
      wrong.loaded.dispose();
    }
    const bad = await fixture({ badPagination: true });
    try {
      await expect(
        bad.source.browse!("popular", { kind: "tv", page: 1, limit: 24 }),
      ).rejects.toThrow(/pagination/);
    } finally {
      bad.loaded.dispose();
    }
  });
  it.each([
    { videoType: 2 },
    { videoUrl: "http://example.com/video.mp4" },
    { videoUrl: "https://example.com/embed/watch" },
  ])(
    "does not mislabel an embed or insecure URL as direct video: %j",
    async (state) => {
      const f = await fixture(state);
      try {
        await expect(f.source.getStreams("tv|26|305")).rejects.toThrow(
          /direct playable/,
        );
      } finally {
        f.loaded.dispose();
      }
    },
  );
});
