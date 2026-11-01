import { kisskhRequestKey } from "./request-key.js";

const BASE = "https://kisskh.co";
const MAX_EPISODES = 2000;
function https(value) {
  return typeof value === "string" &&
    value.length <= 2048 &&
    /^https:\/\/[a-z0-9.-]+(?::443)?(?:\/|$)/i.test(value) &&
    !/[\r\n\0]/.test(value)
    ? value
    : undefined;
}
function numeric(value) {
  if (
    typeof value !== "number" &&
    !(typeof value === "string" && /^\d{1,10}$/.test(value))
  )
    return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2147483647
    ? String(number)
    : null;
}
function parseTitle(value) {
  const parts = String(value).split("|");
  if (
    parts.length !== 2 ||
    !["movie", "tv"].includes(parts[0]) ||
    !/^\d{1,10}$/.test(parts[1]) ||
    numeric(parts[1]) !== parts[1]
  )
    throw Error("Invalid KissKH title. Search again.");
  return { id: parts[1], kind: parts[0], key: parts.join("|") };
}
function parseEntry(value) {
  const parts = String(value).split("|");
  if (
    parts.length !== 3 ||
    !/^\d{1,10}$/.test(parts[2]) ||
    numeric(parts[2]) !== parts[2]
  )
    throw Error("Invalid KissKH episode. Reload the title.");
  return { ...parseTitle(parts.slice(0, 2).join("|")), episodeId: parts[2] };
}
function sourceType(kind) {
  if (kind !== "movie" && kind !== "tv")
    throw Error("Choose Movies or TV series for KissKH.");
  return kind === "movie" ? 2 : 1;
}
const limitOf = (value) =>
  Number.isInteger(value) ? Math.max(1, Math.min(24, value)) : 24;
function mapTitles(rows, kind, limit) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => {
      const id = numeric(row?.id);
      if (
        !id ||
        typeof row.title !== "string" ||
        !row.title.trim() ||
        seen.has(id)
      )
        return false;
      seen.add(id);
      return true;
    })
    .slice(0, limit)
    .map((row) => ({
      id: `${kind}|${numeric(row.id)}`,
      kind,
      title: row.title.slice(0, 500),
      ...(https(row.thumbnail) ? { cover: row.thumbnail } : {}),
      url: `${BASE}/Drama/Title?id=${numeric(row.id)}`,
    }));
}
export function activate({ host }) {
  const details = new Map();
  const headers = { Accept: "application/json", Referer: BASE + "/" };
  async function request(path) {
    const response = await host.fetch({ url: BASE + "/api/" + path, headers });
    if (response.status !== 200)
      throw Error(`KissKH request failed (${response.status}). Retry later.`);
    try {
      return JSON.parse(response.body);
    } catch {
      throw Error("KissKH returned an unreadable response.");
    }
  }
  async function detail(title) {
    const hit = details.get(title.key);
    if (hit && hit.expires > Date.now()) return hit.data;
    const data = await request(`DramaList/Drama/${title.id}?isq=false`);
    if (
      numeric(data?.id) !== title.id ||
      data.type !== (title.kind === "movie" ? "Movie" : "TVSeries")
    )
      throw Error(
        "KissKH returned a different title or media type. Search again.",
      );
    if (!Array.isArray(data.episodes))
      throw Error("KissKH returned an invalid episode list.");
    if (details.size >= 40) details.delete(details.keys().next().value);
    details.set(title.key, { data, expires: Date.now() + 60000 });
    return data;
  }
  return {
    async search(query, { kind, limit = 20 } = {}) {
      const type = sourceType(kind),
        text = String(query).trim().slice(0, 500);
      if (!text) return [];
      const data = await request(
        `DramaList/Search?q=${encodeURIComponent(text)}&type=${type}`,
      );
      if (!Array.isArray(data))
        throw Error("KissKH returned an invalid search response.");
      return mapTitles(
        data,
        kind,
        Math.min(50, Math.max(1, Number.isInteger(limit) ? limit : 20)),
      );
    },
    async browse(category, { kind, page = 1, limit = 24 } = {}) {
      const type = sourceType(kind),
        categories = ["popular", "latest", "ongoing", "upcoming"];
      if (!categories.includes(category))
        throw Error("This KissKH collection is unavailable.");
      const current = Number.isInteger(page)
        ? Math.max(1, Math.min(100, page))
        : 1;
      const status =
        category === "ongoing" ? 1 : category === "upcoming" ? 3 : 0;
      const order = category === "popular" ? 1 : 2;
      const data = await request(
        `DramaList/List?page=${current}&type=${type}&sub=0&country=0&status=${status}&order=${order}`,
      );
      if (
        !Array.isArray(data?.data) ||
        !Number.isInteger(data.pageSize) ||
        data.pageSize < 1 ||
        !Number.isFinite(data.totalCount)
      )
        throw Error("KissKH returned invalid collection pagination.");
      return {
        items: mapTitles(data.data, kind, limitOf(limit)),
        hasMore: current * data.pageSize < data.totalCount,
      };
    },
    async getEpisodes(titleId) {
      const title = parseTitle(titleId),
        data = await detail(title),
        seen = new Set();
      return data.episodes
        .filter((row) => {
          const id = numeric(row?.id);
          if (
            !id ||
            seen.has(id) ||
            typeof row.number !== "number" ||
            !Number.isFinite(row.number) ||
            row.number < 0 ||
            row.number > 10000
          )
            return false;
          seen.add(id);
          return true;
        })
        .slice(0, MAX_EPISODES)
        .sort((a, b) => a.number - b.number)
        .map((row) => ({
          id: `${title.key}|${numeric(row.id)}`,
          animeId: title.key,
          number: row.number,
          title: title.kind === "movie" ? data.title : `Episode ${row.number}`,
        }));
    },
    async getStreams(entryId) {
      const entry = parseEntry(entryId),
        data = await detail(entry);
      if (!data.episodes.some((row) => numeric(row.id) === entry.episodeId))
        throw Error(
          "This KissKH episode no longer belongs to the selected title.",
        );
      const video = await request(
        `DramaList/Episode/${entry.episodeId}.png?err=false&ts=null&time=null&kkey=${kisskhRequestKey(entry.episodeId)}`,
      );
      const url = https(video?.Video);
      if (
        video?.id ||
        !url ||
        ![0, 1].includes(video.Type) ||
        !/\.(mp4|m3u8)(?:[?#]|$)/i.test(url)
      )
        throw Error(
          "KissKH did not return a direct playable video. Try another entry or source.",
        );
      let subtitles = [];
      try {
        const rows = await request(
          `Sub/${entry.episodeId}?kkey=${kisskhRequestKey(entry.episodeId, true)}`,
        );
        subtitles = (Array.isArray(rows) ? rows : [])
          .filter(
            (row) =>
              https(row.src) &&
              /\.(srt|vtt)(?:[?#]|$)/i.test(row.src) &&
              typeof row.label === "string",
          )
          .slice(0, 50)
          .map((row, index) => ({
            id: `kisskh-${entry.episodeId}-${index}`,
            url: row.src,
            language: String(row.land || row.label).slice(0, 100),
            title: row.label.slice(0, 200),
            isDefault: row.default === true,
          }));
      } catch {
        /* A subtitle outage must not prevent direct video playback. */
      }
      return [
        {
          server: "KissKH",
          videoSources: [
            {
              url,
              type: video.Type === 1 ? "hls" : "mp4",
              quality: "auto",
              headers: { Referer: BASE + "/" },
              ...(subtitles.length ? { subtitles } : {}),
            },
          ],
        },
      ];
    },
  };
}
