const BASE = "https://archive.org";
const COLLECTION = "collection:feature_films AND mediatype:movies";
function identifier(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value) ||
    value.includes("..")
  )
    throw Error("Invalid Internet Archive item ID.");
  return value;
}
function yes(value) {
  return value === true || value === 1 || value === "true" || value === "1";
}
function fileName(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    !/[\x00-\x1f\x7f\\]/.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
  );
}
function download(id, name) {
  return (
    BASE +
    "/download/" +
    encodeURIComponent(id) +
    "/" +
    name.split("/").map(encodeURIComponent).join("/")
  );
}
function duration(value) {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  if (/^\d+(?:\.\d+)?$/.test(String(value))) return Number(value);
  if (/^\d{1,3}:\d{2}:\d{2}(?:\.\d+)?$/.test(String(value)))
    return String(value)
      .split(":")
      .reduce((sum, part) => sum * 60 + Number(part), 0);
  return 0;
}
function mp4Files(data) {
  const files = data.files.filter(
    (file) =>
      file &&
      !yes(file.private) &&
      fileName(file.name) &&
      /\.mp4$/i.test(file.name) &&
      !/(?:^|[ _.-])(?:sample|preview|trailer)(?:[ _.-]|$)/i.test(file.name) &&
      Number(file.size) >= 1024 * 1024 &&
      Number(file.size) <= 50 * 1024 ** 3 &&
      (!duration(file.length) || duration(file.length) >= 600),
  );
  // Do not offer a short bonus/trailer as a feature-quality alternative.
  const longest = Math.max(0, ...files.map((file) => duration(file.length)));
  return files
    .filter((file) => !longest || duration(file.length) >= longest * 0.95)
    .sort(
      (a, b) =>
        (Number(b.height) || 0) - (Number(a.height) || 0) ||
        Number(b.size) - Number(a.size),
    )
    .slice(0, 8);
}
function kind(options) {
  if (options?.kind && options.kind !== "movie")
    throw Error("Internet Archive Classics supports Movies only.");
}
export function activate({ host }) {
  const cache = new Map(),
    pending = new Map();
  async function json(path) {
    const response = await host.fetch({ url: BASE + path });
    if (response.status !== 200)
      throw Error(`Internet Archive request failed (${response.status}).`);
    try {
      return JSON.parse(response.body);
    } catch {
      throw Error("Internet Archive returned invalid JSON.");
    }
  }
  async function metadata(value) {
    const id = identifier(value),
      cached = cache.get(id);
    if (cached && cached.until > Date.now()) return cached.data;
    if (pending.has(id)) return pending.get(id);
    const request = (async () => {
      const data = await json("/metadata/" + encodeURIComponent(id));
      const meta = data?.metadata;
      const collections = Array.isArray(meta?.collection)
        ? meta.collection
        : [meta?.collection];
      if (
        !meta ||
        meta.identifier !== id ||
        meta.mediatype !== "movies" ||
        !collections.includes("feature_films") ||
        yes(data.is_dark) ||
        yes(meta["access-restricted-item"]) ||
        yes(meta.is_dark) ||
        !Array.isArray(data.files) ||
        data.files.length > 2000
      )
        throw Error(
          "This archive item is unavailable, restricted or outside the feature-film collection.",
        );
      // Retain only fields needed for playback; descriptions and unrelated
      // archive files must not multiply across a bounded metadata cache.
      const bounded = {
        metadata: {
          language: String(
            Array.isArray(meta.language)
              ? (meta.language[0] ?? "Unknown")
              : (meta.language ?? "Unknown"),
          ).slice(0, 100),
        },
        files: data.files
          .filter(
            (file) =>
              file &&
              fileName(file.name) &&
              /\.(mp4|srt|vtt)$/i.test(file.name),
          )
          .slice(0, 200)
          .map((file) => ({
            name: file.name,
            private: yes(file.private),
            size: Number(file.size),
            height: Number(file.height),
            length:
              typeof file.length === "string"
                ? file.length.slice(0, 24)
                : Number(file.length) || 0,
          })),
      };
      cache.delete(id);
      cache.set(id, { data: bounded, until: Date.now() + 10 * 60 * 1000 });
      while (cache.size > 32) cache.delete(cache.keys().next().value);
      return bounded;
    })().finally(() => pending.delete(id));
    pending.set(id, request);
    return request;
  }
  async function list(query, sort, page, limit) {
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 100 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50
    )
      throw Error("Invalid Internet Archive pagination.");
    const path =
      "/advancedsearch.php?q=" +
      encodeURIComponent(query) +
      "&output=json&rows=" +
      limit +
      "&page=" +
      page +
      "&sort%5B%5D=" +
      encodeURIComponent(sort) +
      "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year";
    const data = await json(path),
      response = data?.response;
    if (
      !response ||
      !Array.isArray(response.docs) ||
      response.docs.length > limit ||
      !Number.isSafeInteger(response.numFound) ||
      response.numFound < 0
    )
      throw Error("Internet Archive returned invalid search results.");
    const seen = new Set();
    const items = response.docs.flatMap((row) => {
      try {
        const id = identifier(row?.identifier);
        if (seen.has(id) || typeof row.title !== "string" || !row.title.trim())
          return [];
        seen.add(id);
        const year = Number(String(row.year ?? "").slice(0, 4));
        return [
          {
            id,
            kind: "movie",
            title: row.title.trim().slice(0, 500),
            ...(Number.isInteger(year) && year >= 1800 && year <= 2200
              ? { year }
              : {}),
            cover: BASE + "/services/img/" + encodeURIComponent(id),
            url: BASE + "/details/" + encodeURIComponent(id),
          },
        ];
      } catch {
        return [];
      }
    });
    return { items, hasMore: page * limit < response.numFound };
  }
  return {
    async search(query, options = {}) {
      kind(options);
      if (typeof query !== "string" || !query.trim()) return [];
      if (query.length > 300)
        throw Error("Internet Archive search is too long.");
      const literal = query.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return (
        await list(
          COLLECTION + ' AND title:"' + literal + '"',
          "downloads desc",
          1,
          Math.min(50, Math.max(1, options.limit ?? 20)),
        )
      ).items;
    },
    async browse(category, options = {}) {
      kind(options);
      if (!["popular", "latest"].includes(category))
        throw Error("Internet Archive offers Popular and Latest additions.");
      return list(
        COLLECTION,
        category === "popular" ? "downloads desc" : "publicdate desc",
        options.page ?? 1,
        options.limit ?? 14,
      );
    },
    async getEpisodes(id) {
      const data = await metadata(id);
      if (!mp4Files(data).length)
        throw Error(
          "This archive item has no supported public feature-length MP4.",
        );
      return [
        { id: id + "|feature", animeId: id, number: 1, title: "Watch film" },
      ];
    },
    async getStreams(entry, { excludeServers = [] } = {}) {
      if (excludeServers.includes("Internet Archive"))
        throw Error("No untried Internet Archive server remains.");
      if (typeof entry !== "string" || !entry.endsWith("|feature"))
        throw Error("Invalid Internet Archive feature ID.");
      const id = identifier(entry.slice(0, -8)),
        data = await metadata(id),
        files = mp4Files(data);
      if (!files.length)
        throw Error(
          "This archive item has no supported public feature-length MP4.",
        );
      const language =
        (Array.isArray(data.metadata.language)
          ? data.metadata.language[0]
          : data.metadata.language) || "Unknown";
      const subtitles = data.files
        .filter(
          (file) =>
            file &&
            !yes(file.private) &&
            fileName(file.name) &&
            /\.(srt|vtt)$/i.test(file.name) &&
            Number(file.size) > 0 &&
            Number(file.size) <= 2 * 1024 * 1024,
        )
        .slice(0, 4)
        .map((file, index) => ({
          id: "archive-sub-" + index,
          url: download(id, file.name),
          language: String(language).slice(0, 100),
          ...(file.name.includes(".asr.") ? { title: "Auto-generated" } : {}),
        }));
      return [
        {
          server: "Internet Archive",
          videoSources: files.map((file) => {
            const height = Number(file.height);
            return {
              url: download(id, file.name),
              type: "mp4",
              quality:
                Number.isInteger(height) && height >= 144 && height <= 4320
                  ? height + "p"
                  : "auto",
              subtitles,
            };
          }),
        },
      ];
    },
  };
}
