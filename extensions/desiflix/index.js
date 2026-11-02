const API = "https://manifest.desitvhub.eu.org";
const META = "https://v3-cinemeta.strem.io";
function imdb(value) {
  if (typeof value !== "string" || !/^tt\d{7,12}$/.test(value))
    throw Error("Invalid IMDb title.");
  return value;
}
function title(value) {
  const parts = String(value).split("|");
  if (parts.length !== 2 || !["movie", "tv"].includes(parts[0]))
    throw Error("Invalid DesiFlix title.");
  return { kind: parts[0], id: imdb(parts[1]), key: parts.join("|") };
}
function episode(value) {
  const parts = String(value).split("|");
  const parsed = title(parts.slice(0, 2).join("|"));
  if (
    parts.length !== 4 ||
    !/^s(?:0|[1-9]\d{0,2})$/.test(parts[2]) ||
    !/^e(?:0|[1-9]\d{0,3})$/.test(parts[3])
  )
    throw Error("Invalid DesiFlix episode.");
  const season = Number(parts[2].slice(1)),
    number = Number(parts[3].slice(1));
  if (parsed.kind === "movie" ? season !== 0 || number !== 0 : number < 1)
    throw Error("Invalid DesiFlix episode numbers.");
  return { ...parsed, season, number };
}
function publicUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\s\\\x00-\x1f]/.test(value)
  )
    return null;
  const host = /^https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(\/[^#]*)?$/i.exec(
    value,
  )?.[1];
  return host &&
    host.includes(".") &&
    !/^[\d.]+$/.test(host) &&
    !/\.(?:local|localhost|internal|test|invalid)$/i.test(host)
    ? value
    : null;
}
function kind(options) {
  if (!["movie", "tv"].includes(options.kind))
    throw Error("Choose Movies or Series.");
  return options.kind;
}
function metadataType(kind) {
  return kind === "tv" ? "series" : "movie";
}
export function activate({ host }) {
  const cache = new Map();
  async function json(url) {
    const hit = cache.get(url);
    if (hit && hit.until > Date.now()) return hit.data;
    const response = await host.fetch({
      url,
      headers: { Accept: "application/json", Referer: API + "/" },
    });
    if (response.status !== 200)
      throw Error(
        `DesiFlix API unavailable (HTTP ${response.status}). Try another provider.`,
      );
    if (response.body.length > 1048576)
      throw Error("DesiFlix API metadata exceeds the source limit.");
    let data;
    try {
      data = JSON.parse(response.body);
    } catch {
      throw Error("DesiFlix returned unreadable API metadata.");
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw Error("DesiFlix returned invalid API metadata.");
    // Playback URLs can expire; retain only catalogue and title metadata.
    if (url.startsWith(META + "/")) {
      cache.delete(url);
      cache.set(url, { data, until: Date.now() + 300000 });
      while (cache.size > 16) cache.delete(cache.keys().next().value);
    }
    return data;
  }
  function card(row, wanted) {
    if (
      !row ||
      row.type !== metadataType(wanted) ||
      typeof row.name !== "string" ||
      !row.name.trim()
    )
      return null;
    let id;
    try {
      id = imdb(row.id);
    } catch {
      return null;
    }
    const year = Number(String(row.releaseInfo || row.year || "").slice(0, 4));
    return {
      id: wanted + "|" + id,
      kind: wanted,
      title: row.name.trim().slice(0, 500),
      ...(Number.isInteger(year) && year >= 1800 && year <= 2200
        ? { year }
        : {}),
      ...(publicUrl(row.poster) ? { cover: row.poster } : {}),
    };
  }
  async function catalogue(wanted, path, limit) {
    const data = await json(
      META + "/catalog/" + metadataType(wanted) + "/top" + path + ".json",
    );
    if (!Array.isArray(data.metas) || data.metas.length > 1000)
      throw Error("Invalid DesiFlix catalogue.");
    const seen = new Set();
    return {
      rawCount: data.metas.length,
      items: data.metas.slice(0, limit).map((row) => {
        const item = card(row, wanted);
        return item && !seen.has(item.id) && !!seen.add(item.id) ? item : null;
      }),
    };
  }
  async function details(parsed) {
    const data = await json(
      META + "/meta/" + metadataType(parsed.kind) + "/" + parsed.id + ".json",
    );
    const meta = data.meta;
    if (
      !meta ||
      meta.id !== parsed.id ||
      meta.type !== metadataType(parsed.kind)
    )
      throw Error("Metadata returned a different title.");
    return meta;
  }
  async function episodes(parsed) {
    if (parsed.kind === "movie")
      return [
        {
          id: parsed.key + "|s0|e0",
          animeId: parsed.key,
          number: 1,
          title: "Watch movie",
        },
      ];
    const meta = await details(parsed);
    if (!Array.isArray(meta.videos) || meta.videos.length > 5000)
      throw Error("Invalid series episode metadata.");
    const seen = new Set();
    return meta.videos
      .flatMap((row) => {
        const season = row.season,
          number = row.episode ?? row.number;
        const aired = Date.parse(row.released || row.firstAired || "");
        if (
          !Number.isInteger(season) ||
          season < 0 ||
          season > 999 ||
          !Number.isInteger(number) ||
          number < 1 ||
          number > 9999 ||
          !Number.isFinite(aired) ||
          aired > Date.now()
        )
          return [];
        const id = `${parsed.key}|s${season}|e${number}`;
        if (seen.has(id)) return [];
        seen.add(id);
        return [
          {
            id,
            animeId: parsed.key,
            season,
            number,
            ...(typeof row.name === "string"
              ? { title: row.name.slice(0, 500) }
              : {}),
          },
        ];
      })
      .sort((a, b) => a.season - b.season || a.number - b.number);
  }
  return {
    async search(query, options = {}) {
      const wanted = kind(options),
        limit = options.limit ?? 20;
      if (
        typeof query !== "string" ||
        query.length > 300 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50
      )
        throw Error("Invalid DesiFlix search.");
      if (!query.trim()) return [];
      if (/^tt\d{7,12}$/.test(query.trim())) {
        const parsed = {
          kind: wanted,
          id: query.trim(),
          key: wanted + "|" + query.trim(),
        };
        const row = card(await details(parsed), wanted);
        return row ? [row] : [];
      }
      return (
        await catalogue(
          wanted,
          "/search=" + encodeURIComponent(query.trim()),
          limit,
        )
      ).items.filter(Boolean);
    },
    async getEpisodes(id) {
      return episodes(title(id));
    },
    async getStreams(id, { excludeServers = [] } = {}) {
      const parsed = episode(id);
      if (
        parsed.kind === "tv" &&
        !(await episodes(parsed)).some((row) => row.id === id)
      )
        throw Error(
          "This episode has not aired or is absent from the series metadata.",
        );
      const key =
        parsed.kind === "movie"
          ? parsed.id
          : `${parsed.id}:${parsed.season}:${parsed.number}`;
      const data = await json(
        API + "/stream/" + metadataType(parsed.kind) + "/" + key + ".json",
      );
      if (!Array.isArray(data.streams) || data.streams.length > 100)
        throw Error("DesiFlix returned invalid streams.");
      const seen = new Set();
      const result = data.streams
        .flatMap((row, index) => {
          const server = "DesiFlix · " + (index + 1),
            url = publicUrl(row?.url);
          const type =
            url && /\.(m3u8|mp4|mkv)(?:\?|$)/i.exec(url)?.[1].toLowerCase();
          if (!type || seen.has(url)) return [];
          seen.add(url);
          if (excludeServers.includes(server)) return [];
          const label = String(
            row.behaviorHints?.filename || row.title || "",
          ).slice(0, 2000);
          const quality =
            /(?:^|[^\d])(2160|1440|1080|720|576|480|360|240)p\b/i.exec(
              label,
            )?.[1];
          return [
            {
              server,
              videoSources: [
                {
                  url,
                  type: type === "m3u8" ? "hls" : type,
                  quality: quality ? quality + "p" : "auto",
                  headers: { Referer: API + "/" },
                },
              ],
            },
          ];
        })
        .slice(0, 25);
      if (!result.length)
        throw Error(
          "No untried direct DesiFlix media remains. Torrents, DRM and embed-only entries are unsupported.",
        );
      return result;
    },
  };
}
