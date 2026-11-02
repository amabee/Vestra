const BASE = "https://api.streamflix.app";
const MIRRORS = [
  "https://bb.streamflixserver.site/file/streamflix/",
  "https://bb.streamflixserver.site/file/streamflix-sv-2/",
  "https://s3.ap-southeast-1.wasabisys.com/streamflix/",
];
function identifier(value) {
  if (typeof value !== "string" || !/^chilflix-\d{1,16}$/.test(value))
    throw Error("Invalid StreamFlix title.");
  return value;
}
function path(value) {
  if (
    typeof value !== "string" ||
    value.length > 1000 ||
    !/^movies\/[A-Za-z0-9_./ -]+\.(mkv|mp4)$/i.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    return null;
  return value.split("/").map(encodeURIComponent).join("/");
}
function kind(options) {
  if (options.kind && options.kind !== "movie")
    throw Error(
      "This StreamFlix port supports movies. The upstream TV API is not publicly available.",
    );
}
function image(value) {
  return typeof value === "string" &&
    /^[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(value)
    ? "https://image.tmdb.org/t/p/w500/" + value
    : undefined;
}
export function activate({ host }) {
  let catalogue, config;
  async function json(endpoint) {
    const response = await host.fetch({
      url: BASE + endpoint,
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200)
      throw Error(
        `StreamFlix API unavailable (HTTP ${response.status}). Try another provider.`,
      );
    if (response.body.length > 4194304)
      throw Error("StreamFlix catalogue exceeds the source limit.");
    try {
      return JSON.parse(response.body);
    } catch {
      throw Error("StreamFlix returned unreadable API data.");
    }
  }
  async function rows() {
    if (catalogue && catalogue.until > Date.now()) return catalogue.rows;
    const data = await json("/data.json");
    if (!Array.isArray(data?.data) || data.data.length > 15000)
      throw Error("StreamFlix returned an invalid catalogue.");
    const seen = new Set();
    const result = data.data.flatMap((row) => {
      if (
        !row ||
        row.isTV !== false ||
        typeof row.moviename !== "string" ||
        !row.moviename.trim() ||
        !path(row.movielink)
      )
        return [];
      let id;
      try {
        id = identifier(row.moviekey);
      } catch {
        return [];
      }
      if (seen.has(id)) return [];
      seen.add(id);
      const year = Number(row.movieyear),
        views = Number(row.movieviews);
      return [
        {
          id,
          title: row.moviename.trim().slice(0, 500),
          kind: "movie",
          ...(Number.isInteger(year) && year >= 1800 && year <= 2200
            ? { year }
            : {}),
          ...(image(row.movieposter) ? { cover: image(row.movieposter) } : {}),
          link: path(row.movielink),
          views: Number.isFinite(views) ? Math.max(0, views) : 0,
        },
      ];
    });
    catalogue = { rows: result, until: Date.now() + 300000 };
    return result;
  }
  async function title(id) {
    identifier(id);
    const row = (await rows()).find((row) => row.id === id);
    if (!row)
      throw Error("This movie is not in StreamFlix's current catalogue.");
    return row;
  }
  function card({ link, views, ...row }) {
    return row;
  }
  return {
    async search(query, options = {}) {
      kind(options);
      if (typeof query !== "string" || query.length > 300)
        throw Error("Invalid StreamFlix search.");
      const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      const limit = options.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        throw Error("Invalid search limit.");
      return (await rows())
        .filter((row) =>
          terms.every((term) => row.title.toLowerCase().includes(term)),
        )
        .slice(0, limit)
        .map(card);
    },
    async browse(category, options = {}) {
      kind(options);
      const page = options.page ?? 1,
        limit = options.limit ?? 14;
      if (
        !["popular", "latest"].includes(category) ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 1000 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        throw Error("Invalid StreamFlix discovery request.");
      const sorted = [...(await rows())].sort(
        category === "popular"
          ? (a, b) => b.views - a.views || a.id.localeCompare(b.id)
          : (a, b) => Number(b.id.slice(9)) - Number(a.id.slice(9)),
      );
      const start = (page - 1) * limit;
      return {
        items: sorted.slice(start, start + limit).map(card),
        hasMore: start + limit < sorted.length,
      };
    },
    async getEpisodes(id) {
      await title(id);
      return [
        { id: id + "|feature", animeId: id, number: 1, title: "Watch movie" },
      ];
    },
    async getStreams(id, { excludeServers = [] } = {}) {
      if (typeof id !== "string" || !id.endsWith("|feature"))
        throw Error("Invalid StreamFlix movie entry.");
      const row = await title(id.slice(0, -8));
      if (!config || config.until <= Date.now()) {
        const data = await json("/config/config-streamflixapp.json");
        // Upstream config cannot introduce arbitrary media hosts or fabricated paths.
        const bases = [
          ...new Set([
            ...(Array.isArray(data?.movies) ? data.movies : []),
            ...(Array.isArray(data?.premium) ? data.premium : []),
          ]),
        ].filter((base) => MIRRORS.includes(base));
        if (!bases.length)
          throw Error(
            "StreamFlix has no recognised movie mirrors. The source needs an update.",
          );
        config = { bases, until: Date.now() + 300000 };
      }
      const result = config.bases
        .map((base) => {
          const server = "StreamFlix · " + (MIRRORS.indexOf(base) + 1);
          return {
            server,
            videoSources: [
              {
                url: base + row.link,
                type: /\.mkv$/i.test(row.link) ? "mkv" : "mp4",
                quality: "auto",
                headers: { Referer: BASE + "/" },
              },
            ],
          };
        })
        .filter((row) => !excludeServers.includes(row.server));
      if (!result.length) throw Error("No untried StreamFlix mirror remains.");
      return result;
    },
  };
}
