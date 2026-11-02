const BASE = "https://vixsrc.to";
function title(value) {
  const parts = String(value).split("|");
  if (
    parts.length !== 2 ||
    !["movie", "tv"].includes(parts[0]) ||
    !/^[1-9]\d{0,9}$/.test(parts[1])
  )
    throw Error("Invalid VixSrc title. Search again.");
  return { kind: parts[0], id: parts[1], key: parts.join("|") };
}
function entry(value) {
  const parts = String(value).split("|");
  if (
    parts.length !== 4 ||
    !/^s(?:0|[1-9]\d{0,2})$/.test(parts[2]) ||
    !/^e(?:0|[1-9]\d{0,3})$/.test(parts[3])
  )
    throw Error("Invalid VixSrc episode. Reload the title.");
  const parsed = title(parts.slice(0, 2).join("|"));
  const season = Number(parts[2].slice(1)),
    number = Number(parts[3].slice(1));
  if (
    (parsed.kind === "movie" && (season !== 0 || number !== 0)) ||
    (parsed.kind === "tv" && number < 1)
  )
    throw Error("Invalid VixSrc episode numbers.");
  return { ...parsed, season, number };
}
function catalogueId(value) {
  return (typeof value === "number" || typeof value === "string") &&
    /^[1-9]\d{0,9}$/.test(String(value))
    ? String(value)
    : null;
}
export function activate({ host }) {
  const indexes = new Map();
  const pending = new Map();
  const headers = {
    Accept: "application/json,text/html,application/vnd.apple.mpegurl",
    Referer: BASE + "/",
  };
  async function request(path) {
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      /[\r\n\0\\]/.test(path)
    )
      throw Error("Invalid VixSrc request.");
    return host.fetch({ url: BASE + path, headers });
  }
  async function available(kind) {
    const hit = indexes.get(kind);
    if (hit && hit.until > Date.now()) return hit.ids;
    if (pending.has(kind)) return pending.get(kind);
    const promise = (async () => {
      const response = await request("/api/list/" + kind + "/");
      if (response.status !== 200)
        throw Error(`VixSrc catalogue unavailable (${response.status}).`);
      let data;
      try {
        data = JSON.parse(response.body);
      } catch {
        throw Error("VixSrc returned an unreadable catalogue.");
      }
      if (!Array.isArray(data) || data.length > 100000)
        throw Error("VixSrc returned an invalid catalogue.");
      const ids = new Set(
        data.map((row) => catalogueId(row?.tmdb_id)).filter(Boolean),
      );
      indexes.set(kind, { ids, until: Date.now() + 15 * 60 * 1000 });
      return ids;
    })().finally(() => pending.delete(kind));
    pending.set(kind, promise);
    return promise;
  }
  async function assertTitle(parsed) {
    if (!(await available(parsed.kind)).has(parsed.id))
      throw Error(
        "This title is not in VixSrc's current catalogue. Choose another provider.",
      );
  }
  return {
    async matchCatalogue(ids) {
      if (!Array.isArray(ids) || ids.length > 50)
        throw Error("Invalid catalogue candidates.");
      const parsed = ids.map(title),
        result = [];
      for (const kind of ["movie", "tv"]) {
        const rows = parsed.filter((row) => row.kind === kind);
        if (!rows.length) continue;
        const found = await available(kind);
        for (const row of rows)
          if (found.has(row.id) && !result.includes(row.key))
            result.push(row.key);
      }
      return result;
    },
    async search(query, { kind } = {}) {
      if (!["movie", "tv"].includes(kind))
        throw Error("Choose Movies or TV series.");
      const id = /^(?:tmdb:)?([1-9]\d{0,9})$/i.exec(String(query).trim())?.[1];
      if (!id)
        throw Error(
          "VixSrc title search uses Vestra's configured TMDb catalogue.",
        );
      if (!(await available(kind)).has(id)) return [];
      return [{ id: kind + "|" + id, kind, title: "TMDb " + id }];
    },
    async browse() {
      throw Error("VixSrc discovery uses Vestra's configured TMDb catalogue.");
    },
    async getEpisodes(titleId, hints = []) {
      const parsed = title(titleId);
      await assertTitle(parsed);
      if (parsed.kind === "movie")
        return [
          {
            id: titleId + "|s0|e0",
            animeId: titleId,
            number: 1,
            title: "Watch movie",
          },
        ];
      if (!Array.isArray(hints) || hints.length > 2000)
        throw Error("Invalid episode metadata.");
      const seen = new Set();
      return hints
        .filter(
          (row) =>
            row &&
            row.animeId === titleId &&
            Number.isInteger(row.season) &&
            row.season >= 0 &&
            row.season <= 999 &&
            Number.isInteger(row.number) &&
            row.number >= 1 &&
            row.number <= 9999 &&
            row.id === `${titleId}|s${row.season}|e${row.number}` &&
            !seen.has(row.id) &&
            !!seen.add(row.id),
        )
        .sort((a, b) => a.season - b.season || a.number - b.number)
        .map((row) => ({
          id: row.id,
          animeId: titleId,
          season: row.season,
          number: row.number,
          ...(typeof row.title === "string"
            ? { title: row.title.slice(0, 500) }
            : {}),
        }));
    },
    async getStreams(episodeId, { excludeServers = [] } = {}) {
      if (excludeServers.includes("VixSrc"))
        throw Error("No untried VixSrc server remains.");
      const parsed = entry(episodeId);
      await assertTitle(parsed);
      const endpoint =
        parsed.kind === "movie"
          ? `/api/movie/${parsed.id}`
          : `/api/tv/${parsed.id}/${parsed.season}/${parsed.number}`;
      let html;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request(endpoint);
        if (response.status !== 200)
          throw Error(
            `VixSrc could not resolve this entry (${response.status}). It may be unavailable.`,
          );
        let data;
        try {
          data = JSON.parse(response.body);
        } catch {
          throw Error("VixSrc returned invalid playback metadata.");
        }
        if (
          typeof data.src !== "string" ||
          data.src.length > 4096 ||
          !/^\/embed\/[1-9]\d*\?[^#]*$/.test(data.src) ||
          /[\r\n\0\\]/.test(data.src)
        )
          throw Error("VixSrc returned an unexpected embed address.");
        const embed = await request(data.src);
        if (embed.status === 410 && attempt === 0) continue;
        if (embed.status !== 200)
          throw Error(`VixSrc player metadata unavailable (${embed.status}).`);
        html = embed.body;
        break;
      }
      if (!html || html.length > 300000)
        throw Error("VixSrc returned invalid player metadata.");
      const config =
        /window\.masterPlaylist\s*=\s*\{([\s\S]{1,4000}?)\n\s*\}/.exec(
          html,
        )?.[1];
      const url =
        /url:\s*['"](https:\/\/vixsrc\.to\/playlist\/[1-9]\d*)['"]/.exec(
          html,
        )?.[1];
      const token = /'token':\s*'([A-Za-z0-9_-]{1,256})'/.exec(
        config ?? "",
      )?.[1];
      const expires = /'expires':\s*'(\d{10,13})'/.exec(config ?? "")?.[1];
      const asn = /'asn':\s*'([A-Za-z0-9_-]{0,100})'/.exec(config ?? "")?.[1];
      if (
        !url ||
        !token ||
        !expires ||
        Number(expires) * 1000 <= Date.now() + 5000
      )
        throw Error("VixSrc did not return a fresh native playlist.");
      const playlist =
        url +
        "?token=" +
        encodeURIComponent(token) +
        "&expires=" +
        expires +
        (asn ? "&asn=" + encodeURIComponent(asn) : "") +
        "&h=1&lang=en";
      const master = await request(playlist.slice(BASE.length));
      if (
        master.status !== 200 ||
        !master.body.trimStart().startsWith("#EXTM3U") ||
        !master.body.includes("#EXT-X-STREAM-INF:")
      )
        throw Error("VixSrc did not return a playable HLS master playlist.");
      // Keep the master intact: its video renditions reference separate audio
      // and subtitle groups. Splitting it into video-only URLs loses those tracks.
      return [
        {
          server: "VixSrc",
          videoSources: [
            {
              url: playlist,
              type: "hls",
              quality: "auto",
              headers: { Referer: BASE + "/" },
            },
          ],
        },
      ];
    },
  };
}
