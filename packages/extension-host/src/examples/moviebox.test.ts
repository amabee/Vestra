import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createQuickJSRuntime } from "../runtime/quickjs";
import { createStreamSourceProvider } from "../provider";
import { parseManifest } from "../manifest";
import { createBrokeredFetch } from "../net";
import { grantCoversRequest } from "../permissions";

const folder = new URL("../../../../extensions/moviebox/", import.meta.url);
const title = (over = {}) => ({
  subjectId: "1234567890123456789",
  subjectType: 2,
  detailPath: "sample-show",
  title: "Sample S2",
  season: 2,
  releaseDate: "2025-01-01",
  cover: { url: "https://pbcdnw.aoneroom.com/poster.jpg" },
  hasResource: true,
  ...over,
});
async function fixture(over: Record<string, unknown> = {}) {
  const calls: {
    url: string;
    headers: Record<string, string>;
    body: string | null;
  }[] = [];
  const state: {
    tokens: number;
    expired: boolean;
    captionFailure: boolean;
    play?: unknown;
  } = { tokens: 0, expired: false, captionFailure: false, ...over };
  const manifest = parseManifest(
    JSON.parse(await readFile(new URL("manifest.json", folder), "utf8")),
  ).manifest!;
  const grant = {
    extensionId: manifest.id,
    granted: manifest.permissions,
    allowedHosts: manifest.hosts,
    grantedForVersion: manifest.version,
    grantedAt: new Date().toISOString(),
  };
  const fetcher = createBrokeredFetch(grant, {
    request: async (
      input,
    ): Promise<{
      status: number;
      headers: Record<string, string>;
      body: string;
    }> => {
      calls.push(input);
      const path = new URL(input.url).pathname;
      let data: unknown = {};
      if (path.endsWith("/country-code")) {
        state.tokens++;
        return {
          status: 200,
          headers: {
            "x-user": JSON.stringify({
              token: "guest-fixture-" + state.tokens,
            }),
          },
          body: '{"code":0,"data":{"countryCode":"PH"}}',
        };
      }
      expect(input.headers.authorization).toBe(
        "Bearer guest-fixture-" + state.tokens,
      );
      if (state.expired) {
        state.expired = false;
        return { status: 401, headers: {}, body: '{"code":401,"data":null}' };
      }
      if (path.endsWith("/subject/search"))
        data = {
          items: [
            title(),
            title({ title: "Sample S1", season: 1, releaseDate: "2020-01-01" }),
            title({
              subjectId: "999",
              subjectType: 1,
              title: "Sample film",
              detailPath: "sample-film",
            }),
            title({ subjectId: "888", detailPath: "../../bad" }),
          ],
        };
      else if (path.endsWith("/subject/filter"))
        data = { items: [title()], pager: { hasMore: true } };
      else if (path.endsWith("/detail"))
        data = {
          subject: title({
            subjectType: input.url.includes("sample-film") ? 1 : 2,
            subjectId: input.url.includes("sample-film")
              ? "999"
              : title().subjectId,
          }),
          resource: {
            seasons: [
              { se: 0, maxEp: 1, allEp: "1" },
              { se: 1, maxEp: 3, allEp: "1,3" },
              { se: 2, maxEp: 2, allEp: "" },
            ],
          },
          isForbid: false,
        };
      else if (path.endsWith("/subject/play"))
        data = state.play ?? {
          limited: false,
          hasResource: true,
          vipLocked: true,
          streams: [
            {
              id: "11",
              format: "MP4",
              resolutions: "480",
              url: "https://bcdnxw.hakunaymatata.com/free.mp4",
              vipLocked: false,
            },
            {
              id: "22",
              format: "MP4",
              resolutions: "1080",
              url: "https://bcdnxw.hakunaymatata.com/premium.mp4",
              vipLocked: true,
            },
            {
              id: "33",
              format: "MP4",
              resolutions: "720",
              url: "https://bcdnxw.hakunaymatata.com/unknown.mp4",
            },
          ],
        };
      else if (path.endsWith("/subject/caption")) {
        if (state.captionFailure) throw Error("Caption offline");
        data = {
          captions: [
            {
              id: "1",
              lan: "en",
              lanName: "English",
              url: "https://cacdn.hakunaymatata.com/en.srt",
              delay: 0,
            },
            { id: "2", lan: "en", url: "http://example.com/insecure.srt" },
          ],
        };
      } else throw Error("Unexpected fixture path: " + path);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ code: 0, data }),
      };
    },
  });
  const loaded = await createQuickJSRuntime().load({
    extensionId: manifest.id,
    source: await readFile(new URL("index.js", folder), "utf8"),
    bridge: { extensionId: manifest.id, fetch: fetcher!, log() {} },
  });
  const source = createStreamSourceProvider({
    extensionId: manifest.id,
    name: manifest.name,
    kinds: manifest.kinds,
    browseCategories: manifest.discovery!.categories,
    methods: ["search", "browse", "getEpisodes", "getStreams"],
    call: (method, args, signal) => loaded.call(method, [...args], signal),
  });
  return { source, calls, state, loaded, manifest, grant };
}
describe("native MovieBox extension in the real isolate and network broker", () => {
  it("requires an explicit session grant and does not widen an older network-only grant", async () => {
    const f = await fixture();
    try {
      expect(f.manifest.sdkVersion).toBe("1.4.0");
      expect(
        grantCoversRequest(
          { ...f.grant, granted: ["network"] },
          f.manifest.permissions,
          f.manifest.hosts,
        ),
      ).toBe(false);
      expect(
        parseManifest({ ...f.manifest, permissions: ["network:session"] })
          .manifest,
      ).toBeNull();
    } finally {
      f.loaded.dispose();
    }
  });
  it("searches by kind, preserves long IDs and merges season duplicates into their original year", async () => {
    const f = await fixture();
    try {
      const rows = await f.source.search("sample", { kind: "tv" });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: "tv|1234567890123456789|sample-show",
        title: "Sample",
        kind: "tv",
        year: 2020,
      });
      expect(
        JSON.parse(
          f.calls.find((row) => row.url.endsWith("/subject/search"))!.body!,
        ).subjectType,
      ).toBe(2);
      expect(
        (await f.source.search("sample", { kind: "movie" }))[0]!.kind,
      ).toBe("movie");
      expect(f.state.tokens).toBe(1);
      expect(f.calls.some((row) => row.url.includes("/subject/play"))).toBe(
        false,
      );
    } finally {
      f.loaded.dispose();
    }
  });
  it("provides real source collection pagination and preserves explicit episode gaps and specials", async () => {
    const f = await fixture();
    try {
      const page = await f.source.browse!("popular", {
        kind: "tv",
        page: 2,
        limit: 24,
      });
      expect(page.hasMore).toBe(true);
      expect(JSON.parse(f.calls.at(-1)!.body!)).toMatchObject({
        page: 2,
        channelId: 2,
        sort: "Hottest",
      });
      await f.source.browse!("latest", { kind: "tv", page: 1, limit: 24 });
      expect(JSON.parse(f.calls.at(-1)!.body!)).toMatchObject({
        sort: "Latest",
      });
      const episodes = await f.source.getEpisodes(page.items[0]!.id);
      expect(episodes.map((row) => [row.season, row.number])).toEqual([
        [0, 1],
        [1, 1],
        [1, 3],
        [2, 1],
        [2, 2],
      ]);
      await f.source.getEpisodes(page.items[0]!.id);
      expect(
        f.calls.filter((row) => row.url.includes("/detail?")),
      ).toHaveLength(1);
      expect((await f.source.getEpisodes("movie|999|sample-film"))[0]!.id).toBe(
        "movie|999|sample-film|s0|e0",
      );
    } finally {
      f.loaded.dispose();
    }
  });
  it("uses the player origin and full title referer, excludes premium/unknown access and returns captions", async () => {
    const f = await fixture();
    try {
      const result = await f.source.getStreams(
        "tv|1234567890123456789|sample-show|s1|e3",
      );
      expect(result[0]!.videoSources).toHaveLength(1);
      expect(result[0]!.videoSources[0]).toMatchObject({
        quality: "480p",
        type: "mp4",
        subtitles: [{ language: "English", isDefault: true }],
      });
      const play = f.calls.find((row) => row.url.includes("/subject/play?"))!;
      expect(play.url).toMatch(/^https:\/\/mzfi.me\//);
      expect(play.headers.referer).toBe(
        "https://mzfi.me/spa/videoPlayPage/movies/sample-show?id=1234567890123456789",
      );
      expect(play.headers["x-vip-restrict"]).toBe("1");
      expect(play.headers.cookie).toBeUndefined();
    } finally {
      f.loaded.dispose();
    }
  });
  it("retries an expired guest once and lets playable video survive caption failure", async () => {
    const f = await fixture({ expired: true, captionFailure: true });
    try {
      expect(
        (
          await f.source.getStreams("tv|1234567890123456789|sample-show|s1|e1")
        )[0]!.videoSources,
      ).toHaveLength(1);
      expect(f.state.tokens).toBe(2);
    } finally {
      f.loaded.dispose();
    }
  });
  it.each([
    { limited: true, streams: [] },
    { limited: false, dailyLimitPreviewSeconds: 60, streams: [] },
    {
      limited: false,
      vipLocked: true,
      streams: [
        {
          format: "MP4",
          vipLocked: true,
          url: "https://bcdnxw.hakunaymatata.com/premium.mp4",
        },
      ],
    },
  ])(
    "reports restricted access without offering a playable URL: %j",
    async (play) => {
      const f = await fixture({ play });
      try {
        await expect(
          f.source.getStreams("tv|1234567890123456789|sample-show|s1|e1"),
        ).rejects.toThrow(/access|limit|unlocked/);
      } finally {
        f.loaded.dispose();
      }
    },
  );
});
