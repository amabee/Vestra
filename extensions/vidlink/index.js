const BASE = "https://vidlink.pro";
function title(value) {
  const parts = String(value).split("|");
  if (
    parts.length !== 2 ||
    !["movie", "tv"].includes(parts[0]) ||
    !/^[1-9]\d{0,9}$/.test(parts[1])
  )
    throw Error("Invalid Vidlink title.");
  return { kind: parts[0], id: parts[1], key: parts.join("|") };
}
function entry(value) {
  const parts = String(value).split("|");
  const parsed = title(parts.slice(0, 2).join("|"));
  if (
    parts.length !== 4 ||
    !/^s(?:0|[1-9]\d{0,2})$/.test(parts[2]) ||
    !/^e(?:0|[1-9]\d{0,3})$/.test(parts[3])
  )
    throw Error("Invalid Vidlink episode.");
  const season = Number(parts[2].slice(1)),
    number = Number(parts[3].slice(1));
  if (parsed.kind === "movie" ? season !== 0 || number !== 0 : number < 1)
    throw Error("Invalid Vidlink episode numbers.");
  return { ...parsed, season, number };
}
function publicUrl(value) {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\s\\\x00-\x1f]/.test(value)
  )
    return null;
  // No credentials, literal IPs, local hosts or ports in media addresses.
  const match =
    /^https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(\/[^#]*)?$/i.exec(value);
  if (
    !match ||
    !match[1].includes(".") ||
    /^[\d.]+$/.test(match[1]) ||
    /\.(?:local|localhost|internal|test|invalid)$/i.test(match[1])
  )
    return null;
  return value;
}
function media(value, quality, subtitles) {
  const url = publicUrl(value);
  const type = url && /\.(m3u8|mp4|mkv)(?:\?|$)/i.exec(url)?.[1].toLowerCase();
  if (!type) return null;
  const height = /^(2160|1440|1080|720|576|480|360|240)p?$/i.exec(
    String(quality),
  );
  return {
    url,
    type: type === "m3u8" ? "hls" : type,
    quality: height ? height[1] + "p" : "auto",
    headers: { Referer: BASE + "/" },
    subtitles,
  };
}
export function activate({ host }) {
  async function json(url, headers = {}) {
    const response = await host.fetch({
      url,
      headers: { Accept: "application/json", ...headers },
    });
    if (response.status !== 200)
      throw Error(
        `Vidlink upstream unavailable (HTTP ${response.status}). Try another provider.`,
      );
    if (response.body.length > 262144)
      throw Error("Vidlink response exceeds the metadata limit.");
    try {
      return JSON.parse(response.body);
    } catch {
      throw Error("Vidlink returned invalid API metadata.");
    }
  }
  return {
    async matchCatalogue(ids) {
      if (!Array.isArray(ids) || ids.length > 50)
        throw Error("Invalid catalogue candidates.");
      // The API resolves TMDb identities directly; availability is checked on Play.
      return [...new Set(ids.map((id) => title(id).key))];
    },
    async search() {
      throw Error("Vidlink search uses Vestra's configured TMDb catalogue.");
    },
    async browse() {
      throw Error("Vidlink discovery uses Vestra's configured TMDb catalogue.");
    },
    async getEpisodes(id, hints = []) {
      const parsed = title(id);
      if (parsed.kind === "movie")
        return [
          { id: id + "|s0|e0", animeId: id, number: 1, title: "Watch movie" },
        ];
      if (!Array.isArray(hints) || hints.length > 2000)
        throw Error("Invalid episode metadata.");
      const seen = new Set();
      return hints
        .filter((row) => {
          if (
            !row ||
            row.animeId !== id ||
            typeof row.id !== "string" ||
            seen.has(row.id)
          )
            return false;
          try {
            const ep = entry(row.id);
            if (
              ep.key !== id ||
              ep.season !== row.season ||
              ep.number !== row.number
            )
              return false;
            seen.add(row.id);
            return true;
          } catch {
            return false;
          }
        })
        .sort((a, b) => a.season - b.season || a.number - b.number)
        .map((row) => ({
          id: row.id,
          animeId: id,
          season: row.season,
          number: row.number,
          ...(typeof row.title === "string"
            ? { title: row.title.slice(0, 500) }
            : {}),
        }));
    },
    async getStreams(id, { excludeServers = [] } = {}) {
      if (excludeServers.includes("Vidlink"))
        throw Error("No untried Vidlink server remains.");
      const parsed = entry(id);
      const encoded = await json(
        "https://enc-dec.app/api/enc-vidlink?text=" + parsed.id,
      );
      if (
        typeof encoded?.result !== "string" ||
        !/^[A-Za-z0-9_+\/=-]{1,4096}$/.test(encoded.result)
      )
        throw Error("Vidlink helper returned an invalid identifier.");
      const encodedId = encodeURIComponent(encoded.result);
      const path =
        parsed.kind === "movie"
          ? "/movie/" + encodedId
          : `/tv/${encodedId}/${parsed.season}/${parsed.number}`;
      const data = await json(BASE + "/api/b" + path, {
        Referer: BASE + "/",
        Origin: BASE,
      });
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw Error("Vidlink returned invalid streams.");
      const captions =
        data.subtitles ||
        data.stream?.subtitles ||
        data.captions ||
        data.stream?.captions ||
        [];
      const subtitles = (Array.isArray(captions) ? captions : [])
        .slice(0, 50)
        .flatMap((sub) => {
          const url = publicUrl(sub?.url);
          return url && /\.(srt|vtt)(?:\?|$)/i.test(url)
            ? [
                {
                  id: "vidlink-sub-" + String(captions.indexOf(sub)),
                  url,
                  language: String(sub.language || sub.lang || "Unknown").slice(
                    0,
                    60,
                  ),
                  title: String(
                    sub.label || sub.name || sub.language || "Subtitles",
                  ).slice(0, 120),
                },
              ]
            : [];
        });
      const candidates = [];
      // Preserve the HLS master and its audio/subtitle groups.
      if (data.stream?.playlist)
        candidates.push(media(data.stream.playlist, "auto", subtitles));
      if (
        !candidates.some(Boolean) &&
        data.stream?.qualities &&
        typeof data.stream.qualities === "object"
      )
        for (const [quality, row] of Object.entries(
          data.stream.qualities,
        ).slice(0, 30))
          candidates.push(media(row?.url, quality, subtitles));
      if (data.url) candidates.push(media(data.url, data.quality, subtitles));
      for (const row of (Array.isArray(data.streams) ? data.streams : []).slice(
        0,
        30,
      ))
        candidates.push(media(row?.url, row?.quality, subtitles));
      for (const row of (Array.isArray(data.links) ? data.links : []).slice(
        0,
        30,
      ))
        candidates.push(media(row?.url, row?.quality, subtitles));
      const seen = new Set();
      const videoSources = candidates
        .filter((row) => row && !seen.has(row.url) && !!seen.add(row.url))
        .slice(0, 50);
      if (!videoSources.length)
        throw Error(
          "Vidlink returned no native HLS, MP4 or MKV video. Embed-only responses are unsupported.",
        );
      return [{ server: "Vidlink", videoSources }];
    },
  };
}
