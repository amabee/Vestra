const API = "https://anidb.app";
const MAX_RESULTS = 50;

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function animeIdFromUrl(value) {
  const match = /^https:\/\/anidb\.app\/anime\/[^/]+-(\d+)(?:[/?#].*)?$/.exec(value);
  return match?.[1] ?? null;
}

function fallbackTitle(value) {
  const match = /^https:\/\/anidb\.app\/anime\/([^/]+)-\d+(?:[/?#].*)?$/.exec(value);
  if (!match?.[1]) return "AniDB title";

  return decodeURIComponent(match[1]).replace(/[-_]+/g, " ");
}

function toItem(id, title) {
  return {
    id,
    title: title || fallbackTitle(id),
    year: null,
    poster: null,
    description: "",
    isSeries: true,
  };
}

async function getResponse(host, url, accept) {
  const response = await host.fetch({
    url,
    headers: { accept },
  });

  if (response.status !== 200) {
    host.log("warn", `AniDB returned ${response.status} for ${url}`);
    return null;
  }

  return response;
}

function parseCards(html, limit, titles) {
  const results = [];
  const seen = Object.create(null);
  const cardRegex = /<a href="(https?:\/\/anidb\.app\/anime\/[^\"]+)" class="anime-card[^\"]*" title="([^\"]+)"/g;
  let match;

  while (results.length < limit && (match = cardRegex.exec(html)) !== null) {
    const id = match[1];
    const title = decodeHtml(match[2]).trim();
    if (!id || !title || seen[id] !== undefined) continue;

    titles[id] = title;
    seen[id] = true;
    results.push(toItem(id, title));
  }

  return results;
}

export function activate({ host }) {
  if (typeof host.fetch !== "function") {
    throw new Error("AniDB needs network access to search.");
  }

  const titles = Object.create(null);

  return {
    async search(query, options) {
      const trimmed = String(query ?? "").trim();
      if (trimmed.length === 0) return [];

      const limit = Math.min(Math.max(1, options?.limit ?? 20), MAX_RESULTS);
      const url = `${API}/browse?q=${encodeURIComponent(trimmed)}`;
      const response = await getResponse(host, url, "text/html");
      if (!response) return [];

      return parseCards(response.body, limit, titles);
    },

    async getTrending(kind, options) {
      if (kind !== "anime") return [];

      const limit = Math.min(Math.max(1, options?.limit ?? 20), MAX_RESULTS);
      const response = await getResponse(host, `${API}/browse`, "text/html");

      return response ? parseCards(response.body, limit, titles) : [];
    },

    async getDetails(id) {
      const key = String(id ?? "");
      const animeId = animeIdFromUrl(key);
      if (!animeId) return null;

      const response = await getResponse(
        host,
        `${API}/api/frontend/anime/${animeId}/episodes`,
        "application/json",
      );

      if (!response) return null;

      let payload;
      try {
        payload = JSON.parse(response.body);
      } catch {
        host.log("warn", "AniDB returned malformed episode data.");
        return null;
      }

      const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];

      return {
        ...toItem(key, titles[key]),
        genres: [],
        episodeCount: episodes.length,
        rating: null,
        streaming: [],
      };
    },

    async getEpisodes(id) {
      const key = String(id ?? "");
      const animeId = animeIdFromUrl(key);
      if (!animeId) return [];

      const response = await getResponse(
        host,
        `${API}/api/frontend/anime/${animeId}/episodes`,
        "application/json",
      );

      if (!response) return [];

      let payload;
      try {
        payload = JSON.parse(response.body);
      } catch {
        return [];
      }

      const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];

      return episodes.map((ep, index) => ({
        id: `${animeId}:${ep.number ?? index + 1}`,
        animeId: key,
        number: Number(ep.number ?? index + 1),
        title: ep.title ?? `Episode ${ep.number ?? index + 1}`,
      }));
    },

    async getStreams(episodeId) {
      const key = String(episodeId ?? "");
      const [rawAnimeId, episodeNumber] = key.split(":");
      const animeId =
        rawAnimeId && /^\d+$/.test(rawAnimeId)
          ? rawAnimeId
          : animeIdFromUrl(rawAnimeId || key);

      if (!animeId || !episodeNumber) return [];

      const response = await getResponse(
        host,
        `${API}/api/frontend/anime/${animeId}/episode/${episodeNumber}/sources`,
        "application/json",
      );

      if (!response) return [];

      let payload;
      try {
        payload = JSON.parse(response.body);
      } catch {
        host.log("warn", "AniDB returned malformed stream data.");
        return [];
      }

      const sources = Array.isArray(payload?.sources) ? payload.sources : [];
      const videoSources = sources.flatMap((source) => {
        const url = typeof source?.url === "string" ? source.url : "";
        if (!url.startsWith("https://")) return [];

        return [
          {
            url,
            quality:
              typeof source.quality === "string" && source.quality.length > 0
                ? source.quality
                : "auto",
            type: /\.m3u8(?:[?#]|$)/i.test(url) ? "hls" : "mp4",
          },
        ];
      });

      return videoSources.length > 0
        ? [{ server: "AniDB", videoSources }]
        : [];
    },
  };
}
