/** Native Vestra integration, based on observed public MovieBox web requests. */
const API = "https://h5-api.aoneroom.com";
const PLAYER = "https://mzfi.me";
const WEB = "https://h5.inmoviebox.com";
const ROOT = "/wefeed-h5api-bff";
const MAX_ENTRIES = 2000;

function https(value) {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  // No URL global is needed inside the isolate.
  return /^https:\/\/[a-z0-9.-]+(?::443)?(?:\/|$)/i.test(value) &&
    !/[\r\n\0]/.test(value)
    ? value
    : undefined;
}
function bounded(value, fallback, max) {
  return Number.isInteger(value) ? Math.min(max, Math.max(1, value)) : fallback;
}
function titleKey(row) {
  const kind =
    Number(row?.subjectType) === 1
      ? "movie"
      : Number(row?.subjectType) === 2
        ? "tv"
        : null;
  const id = row?.subjectId;
  const slug = row?.detailPath;
  return kind &&
    typeof id === "string" &&
    /^\d{1,24}$/.test(id) &&
    typeof slug === "string" &&
    /^[a-z0-9_-]{1,300}$/i.test(slug)
    ? `${kind}|${id}|${slug}`
    : null;
}
function parseTitle(id) {
  const parts = String(id).split("|");
  if (
    parts.length !== 3 ||
    !["movie", "tv"].includes(parts[0]) ||
    !/^\d{1,24}$/.test(parts[1]) ||
    !/^[a-z0-9_-]{1,300}$/i.test(parts[2])
  )
    throw Error("Invalid MovieBox title. Search for it again.");
  return {
    kind: parts[0],
    subjectId: parts[1],
    slug: parts[2],
    id: parts.join("|"),
  };
}
function parseEntry(id) {
  const parts = String(id).split("|");
  if (
    parts.length !== 5 ||
    !/^s\d{1,4}$/.test(parts[3]) ||
    !/^e\d{1,5}$/.test(parts[4])
  )
    throw Error("Invalid MovieBox episode. Reload the title.");
  const title = parseTitle(parts.slice(0, 3).join("|"));
  const season = Number(parts[3].slice(1)),
    episode = Number(parts[4].slice(1));
  if (
    season > 1000 ||
    episode > 10000 ||
    (title.kind === "movie" && (season || episode))
  )
    throw Error("Invalid MovieBox episode numbers.");
  return { ...title, season, episode };
}
function mapTitles(rows, kind, limit) {
  const found = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = titleKey(row);
    if (
      !id ||
      typeof row.title !== "string" ||
      !row.title.trim() ||
      row.hasResource === false ||
      row.isPornographic === true
    )
      continue;
    const parsed = parseTitle(id);
    if (kind && parsed.kind !== kind) continue;
    const year = /^\d{4}-/.test(row.releaseDate || "")
      ? Number(row.releaseDate.slice(0, 4))
      : undefined;
    const title =
      parsed.kind === "tv" && Number(row.season) > 0
        ? row.title.replace(/\s+S\d+(?:\s*-\s*S?\d+)?$/i, "")
        : row.title;
    const mapped = {
      id,
      title: title.slice(0, 500),
      kind: parsed.kind,
      ...(year >= 1800 && year <= 2200 ? { year } : {}),
      ...(https(row.cover?.url) ? { cover: row.cover.url } : {}),
      url: `${WEB}/moviedetail/${parsed.slug}?id=${parsed.subjectId}`,
    };
    const old = found.get(id);
    // Search can repeat one series for each season. Keep the original release year.
    if (!old || (mapped.year && (!old.year || mapped.year < old.year)))
      found.set(id, mapped);
  }
  return [...found.values()].slice(0, limit);
}
function episodeNumbers(season) {
  const max = Number(season.maxEp);
  if (!Number.isInteger(max) || max < 1 || max > 10000) return [];
  const explicit = String(season.allEp ?? "").trim();
  if (!explicit)
    return Array.from(
      { length: Math.min(max, MAX_ENTRIES) },
      (_, index) => index + 1,
    );
  const result = new Set();
  for (const token of explicit.split(",")) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token.trim());
    if (!match)
      throw Error("MovieBox returned an unsupported episode listing.");
    const from = Number(match[1]),
      to = Number(match[2] || match[1]);
    if (from < 0 || to < from || to > max)
      throw Error("MovieBox returned invalid episode availability.");
    for (let number = from; number <= to && result.size < MAX_ENTRIES; number++)
      result.add(number);
  }
  return [...result].sort((a, b) => a - b);
}

export function activate({ host }) {
  let session = null,
    sessionPending = null;
  const details = new Map();
  const baseHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Request-Lang": "en",
    "X-Client-Info": JSON.stringify({ timezone: "UTC" }),
  };
  function header(response, name) {
    return Object.entries(response.headers || {}).find(
      ([key]) => key.toLowerCase() === name,
    )?.[1];
  }
  async function guest() {
    if (session && session.expires > Date.now()) return session.token;
    if (!sessionPending)
      sessionPending = (async () => {
        const response = await host.fetch({
          url: `${API}${ROOT}/country-code`,
          headers: baseHeaders,
        });
        if (response.status !== 200)
          throw Error("MovieBox could not start a guest session.");
        let issued;
        try {
          issued = JSON.parse(header(response, "x-user") || "{}");
        } catch {
          /* Validated below. */
        }
        if (
          typeof issued?.token !== "string" ||
          !issued.token ||
          issued.token.length > 3500 ||
          /[\r\n\0]/.test(issued.token)
        )
          throw Error("MovieBox did not issue a guest session. Retry later.");
        session = { token: issued.token, expires: Date.now() + 5 * 60 * 1000 };
        return session.token;
      })().finally(() => {
        sessionPending = null;
      });
    return sessionPending;
  }
  async function request(
    path,
    { origin = API, body, referer = WEB + "/", headers = {} } = {},
    retry = true,
  ) {
    const token = await guest();
    const response = await host.fetch({
      url: origin + ROOT + path,
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${token}`,
        Referer: referer,
        ...headers,
      },
    });
    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch {
      throw Error("MovieBox returned an unreadable response.");
    }
    const invalidSession =
      response.status === 401 ||
      (payload?.code === 400 && /invalid token/i.test(String(payload.message)));
    if (invalidSession && retry) {
      session = null;
      return request(path, { origin, body, referer, headers }, false);
    }
    if (
      response.status !== 200 ||
      payload?.code !== 0 ||
      !payload.data ||
      typeof payload.data !== "object"
    )
      throw Error(`MovieBox request failed (${response.status}). Retry later.`);
    return payload.data;
  }
  async function detail(title) {
    const hit = details.get(title.id);
    if (hit && hit.expires > Date.now()) return hit.data;
    const data = await request(
      `/detail?detailPath=${encodeURIComponent(title.slug)}`,
    );
    if (
      String(data.subject?.subjectId) !== title.subjectId ||
      Number(data.subject?.subjectType) !== (title.kind === "movie" ? 1 : 2)
    )
      throw Error("MovieBox returned a different title. Search again.");
    if (data.isForbid || data.subject?.hasResource === false)
      throw Error(
        "This MovieBox title is unavailable in your region or has no resources.",
      );
    if (details.size >= 30) details.delete(details.keys().next().value);
    details.set(title.id, { data, expires: Date.now() + 60000 });
    return data;
  }
  return {
    async search(query, { kind, limit = 20 } = {}) {
      const keyword = String(query).trim().slice(0, 500);
      if (!keyword) return [];
      const data = await request("/subject/search", {
        body: {
          keyword,
          page: 1,
          perPage: bounded(limit, 20, 50),
          subjectType: kind === "movie" ? 1 : kind === "tv" ? 2 : 0,
        },
      });
      return mapTitles(data.items, kind, bounded(limit, 20, 50));
    },
    async browse(category, { kind, page = 1, limit = 24 } = {}) {
      if (!["popular", "latest"].includes(category))
        throw Error("MovieBox offers Popular and Latest collections.");
      if (!["movie", "tv"].includes(kind))
        throw Error("Choose Movies or TV series.");
      const current = bounded(page, 1, 100);
      const data = await request("/subject/filter", {
        body: {
          page: current,
          perPage: bounded(limit, 24, 24),
          channelId: kind === "movie" ? 1 : 2,
          sort: category === "latest" ? "Latest" : "Hottest",
        },
      });
      return {
        items: mapTitles(data.items, kind, bounded(limit, 24, 24)),
        hasMore: data.pager?.hasMore === true,
      };
    },
    async getEpisodes(titleId) {
      const title = parseTitle(titleId),
        data = await detail(title);
      if (title.kind === "movie")
        return [
          {
            id: `${title.id}|s0|e0`,
            animeId: title.id,
            number: 1,
            title: data.subject.title || "Play movie",
          },
        ];
      const entries = [];
      for (const season of Array.isArray(data.resource?.seasons)
        ? data.resource.seasons
        : []) {
        const se = Number(season.se);
        if (!Number.isInteger(se) || se < 0 || se > 1000) continue;
        for (const ep of episodeNumbers(season)) {
          if (entries.length >= MAX_ENTRIES) break;
          entries.push({
            id: `${title.id}|s${se}|e${ep}`,
            animeId: title.id,
            season: se,
            number: ep,
            title: `Episode ${ep}`,
          });
        }
      }
      return entries;
    },
    async getStreams(entryId) {
      const entry = parseEntry(entryId);
      const referer = `${PLAYER}/spa/videoPlayPage/movies/${entry.slug}?id=${entry.subjectId}`;
      const data = await request(
        `/subject/play?subjectId=${entry.subjectId}&se=${entry.season}&ep=${entry.episode}&detailPath=${encodeURIComponent(entry.slug)}&streamSignType=1&supportCodecs%5Bh264%5D=1`,
        { origin: PLAYER, referer, headers: { "X-Vip-Restrict": "1" } },
      );
      if (data.limited !== false || Number(data.dailyLimitPreviewSeconds) > 0)
        throw Error(
          "MovieBox requires access or has reached its guest viewing limit. Open the source website.",
        );
      const available = [
        ...(Array.isArray(data.streams) ? data.streams : []),
        ...(Array.isArray(data.hls) ? data.hls : []),
      ].filter(
        (row) =>
          (row.vipLocked === false ||
            (row.vipLocked === undefined && data.vipLocked === false)) &&
          https(row.url) &&
          ["MP4", "HLS"].includes(String(row.format).toUpperCase()) &&
          !row.signCookie,
      );
      if (!available.length)
        throw Error(
          data.vipLocked
            ? "MovieBox offers no unlocked MP4/HLS rendition for this entry."
            : "MovieBox has no playable stream for this entry. Try another episode or source.",
        );
      const best = [...available].sort(
        (a, b) => Number(b.resolutions) - Number(a.resolutions),
      )[0];
      let subtitles = [];
      if (typeof best.id === "string" && /^\d{1,24}$/.test(best.id)) {
        try {
          const captions = await request(
            `/subject/caption?format=${String(best.format).toUpperCase()}&id=${best.id}&subjectId=${entry.subjectId}&detailPath=${encodeURIComponent(entry.slug)}`,
            { referer },
          );
          subtitles = (
            Array.isArray(captions.captions) ? captions.captions : []
          )
            .filter(
              (row) =>
                https(row.url) &&
                typeof row.lan === "string" &&
                row.lan &&
                (!row.delay || Number(row.delay) === 0),
            )
            .slice(0, 50)
            .map((row, index) => ({
              id: `moviebox-${String(row.id || index).slice(0, 100)}`,
              url: row.url,
              language: String(row.lanName || row.lan).slice(0, 100),
              isDefault: row.lan === "en",
            }));
        } catch {
          /* Subtitle lookup must not prevent an otherwise playable video. */
        }
      }
      const videoSources = available.map((row) => ({
        url: row.url,
        quality: /^\d{3,4}$/.test(String(row.resolutions))
          ? `${row.resolutions}p`
          : "auto",
        type: String(row.format).toUpperCase() === "HLS" ? "hls" : "mp4",
        headers: { Referer: referer },
        ...(subtitles.length ? { subtitles } : {}),
      }));
      return [{ server: "MovieBox", videoSources: videoSources.slice(0, 25) }];
    },
  };
}
