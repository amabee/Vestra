import { readFile } from "node:fs/promises";
import { describe, it, expect } from "vitest";
import { createQuickJSRuntime } from "../runtime/quickjs";
import { createBrokeredFetch } from "../net";
import { parseManifest } from "../manifest";
const folder = new URL("../../../../extensions/vixsrc/", import.meta.url);
async function fixture(
  state: {
    expiredEmbed?: boolean;
    badAddress?: boolean;
    badMaster?: boolean;
    badIndex?: boolean;
  } = {},
) {
  const manifest = parseManifest(
    JSON.parse(await readFile(new URL("manifest.json", folder), "utf8")),
  ).manifest!;
  const requests: URL[] = [];
  let embeds = 0;
  const fetcher = createBrokeredFetch(
    {
      extensionId: manifest.id,
      granted: manifest.permissions,
      allowedHosts: manifest.hosts,
      grantedForVersion: manifest.version,
      grantedAt: new Date().toISOString(),
    },
    {
      request: async (input) => {
        const url = new URL(input.url);
        requests.push(url);
        expect(input.headers.referer).toBe("https://vixsrc.to/");
        let body = "";
        let status = 200;
        if (url.pathname.startsWith("/api/list/")) {
          expect(url.pathname.endsWith("/")).toBe(true);
          body = state.badIndex
            ? "{}"
            : JSON.stringify([
                { tmdb_id: 278 },
                { tmdb_id: 1396 },
                { tmdb_id: null },
                { tmdb_id: true },
              ]);
        } else if (url.pathname.startsWith("/api/"))
          body = JSON.stringify({
            src: state.badAddress
              ? "https://evil.example/player"
              : "/embed/55?token=public",
          });
        else if (url.pathname.startsWith("/embed/")) {
          if (state.expiredEmbed && embeds++ === 0) {
            status = 410;
            body = "Gone";
          } else
            body = `<script>window.masterPlaylist = {
params: {
'token': 'publictoken',
'expires': '${Math.floor(Date.now() / 1000) + 3600}',
'asn': '',
},
url: 'https://vixsrc.to/playlist/55',
}</script>`;
        } else if (url.pathname === "/playlist/55")
          body = state.badMaster
            ? "<html>Not video</html>"
            : '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="https://vixsrc.to/playlist/55?type=audio"\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="audio"\nhttps://vixsrc.to/playlist/55?video=1080\n';
        else throw Error("Unexpected host request");
        return { status, headers: { "content-type": "text/plain" }, body };
      },
    },
  );
  if (!fetcher) throw Error("VixSrc fixture requires granted network access");
  const loaded = await createQuickJSRuntime().load({
    extensionId: manifest.id,
    source: await readFile(new URL("index.js", folder), "utf8"),
    bridge: { extensionId: manifest.id, fetch: fetcher, log() {} },
  });
  return {
    manifest,
    requests,
    loaded,
    call: (method: string, ...args: unknown[]) =>
      loaded.call(method, args, AbortSignal.timeout(5000)),
    dispose: () => loaded.dispose(),
  };
}
describe("VixSrc native source", () => {
  it("matches canonical IDs, caches indexes and rejects invalid identities", async () => {
    const f = await fixture();
    try {
      expect(
        await f.call("matchCatalogue", [
          "movie|278",
          "tv|1396",
          "movie|999",
          "movie|278",
        ]),
      ).toEqual(["movie|278", "tv|1396"]);
      await f.call("matchCatalogue", ["movie|278"]);
      expect(
        f.requests.filter((url) => url.pathname.startsWith("/api/list/"))
          .length,
      ).toBe(2);
      await expect(f.call("matchCatalogue", ["movie|../278"])).rejects.toThrow(
        /Invalid/,
      );
    } finally {
      f.dispose();
    }
  });
  it("preserves aired catalogue episode identities, specials and distinct seasons", async () => {
    const f = await fixture();
    try {
      const title = "tv|1396";
      const a = {
        id: title + "|s1|e1",
        animeId: title,
        season: 1,
        number: 1,
        title: "Pilot",
      };
      expect(
        await f.call("getEpisodes", title, [
          a,
          a,
          { ...a, id: title + "|s0|e1", season: 0 },
          { ...a, id: title + "|s5|e1", season: 5 },
          { ...a, animeId: "tv|other" },
        ]),
      ).toEqual([
        { ...a, id: title + "|s0|e1", season: 0 },
        a,
        { ...a, id: title + "|s5|e1", season: 5 },
      ]);
      expect(await f.call("getEpisodes", "movie|278")).toEqual([
        {
          id: "movie|278|s0|e0",
          animeId: "movie|278",
          number: 1,
          title: "Watch movie",
        },
      ]);
    } finally {
      f.dispose();
    }
  });
  it("resolves a fresh HLS master and retains external audio groups", async () => {
    const f = await fixture({ expiredEmbed: true });
    try {
      const result = (await f.call("getStreams", "tv|1396|s5|e1")) as any[];
      const video = result[0].videoSources[0];
      expect(video.type).toBe("hls");
      expect(video.quality).toBe("auto");
      expect(video.headers.Referer).toBe("https://vixsrc.to/");
      const url = new URL(video.url);
      expect(url.pathname).toBe("/playlist/55");
      expect(url.searchParams.get("h")).toBe("1");
      expect(url.searchParams.get("lang")).toBe("en");
      expect(
        f.requests.filter((url) => url.pathname.startsWith("/embed/")).length,
      ).toBe(2);
      await expect(
        f.call("getStreams", "tv|1396|s5|e1", { excludeServers: ["VixSrc"] }),
      ).rejects.toThrow(/untried/);
    } finally {
      f.dispose();
    }
  });
  it.each([{ badAddress: true }, { badMaster: true }, { badIndex: true }])(
    "rejects malformed or non-native delivery %o",
    async (state) => {
      const f = await fixture(state);
      try {
        await expect(f.call("getStreams", "movie|278|s0|e0")).rejects.toThrow();
      } finally {
        f.dispose();
      }
    },
  );
  it("declares host metadata requirements and rejects old or misleading manifests", async () => {
    const f = await fixture();
    try {
      expect(f.manifest.catalogueSource).toBe("tmdb");
      for (const patch of [
        { sdkVersion: "1.4.0" },
        { role: "metadata" },
        { hosts: ["vixsrc.to"] },
        { kinds: ["anime"] },
        { kinds: [] },
      ])
        expect(
          parseManifest({ ...f.manifest, ...patch }).errors.length,
        ).toBeGreaterThan(0);
    } finally {
      f.dispose();
    }
  });
});
