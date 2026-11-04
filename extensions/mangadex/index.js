// lib/manga-common.js
function text(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, key) => {
    if (key[0] !== "#") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[key.toLowerCase()];
    const number = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return number > 0 && number <= 1114111 ? String.fromCodePoint(number) : "";
  }).replace(/\s+/g, " ").trim();
}
function url(raw, origin) {
  let value = String(raw ?? "").replace(/&amp;/g, "&").trim();
  if (value.startsWith("//")) value = "https:" + value;
  else if (value.startsWith("/")) value = origin + value;
  if (value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(\/[^#]*)?$/i.exec(value);
  if (!match) return null;
  let decoded;
  try {
    decoded = decodeURIComponent((match[2] ?? "/").split("?")[0]);
  } catch {
    return null;
  }
  if (/(?:^|\/)\.{1,2}(?:\/|$)|[\\\u0000-\u001f]/.test(decoded)) return null;
  return { value, host: match[1].toLowerCase(), path: match[2] ?? "/" };
}
function pageOptions(options = {}) {
  const page = options.page ?? 1, limit = options.limit ?? 24;
  if (!Number.isInteger(page) || page < 1 || page > 1e3 || !Number.isInteger(limit) || limit < 1 || limit > 400) throw Error("Invalid manga search pagination.");
  return { page, limit: Math.min(50, limit) };
}
function asset(raw, origin, allowed, referer) {
  const parsed = url(raw, origin);
  return parsed && allowed.includes(parsed.host) ? { url: parsed.value, headers: { Referer: referer } } : null;
}
function pages(raw, origin, allowed, referer) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 2e3) throw Error("The source did not return a valid page list.");
  return raw.map((row, index) => {
    const entry = asset(row, origin, allowed, referer);
    if (!entry) throw Error("The source returned an unapproved image host. Check for an extension update.");
    return { ...entry, index };
  });
}
function reader(host, origin) {
  return async (path, json = false) => {
    const response = await host.fetch({ url: origin + path, method: "GET", headers: { Accept: json ? "application/json" : "text/html", Referer: origin + "/" } });
    if (response.status !== 200) throw Error(`Source returned HTTP ${response.status}.`);
    if (typeof response.body !== "string" || response.body.length > 4 * 1024 * 1024) throw Error("Source metadata exceeds its size limit.");
    if (/cf-chl-|<title[^>]*>\s*(?:Just a moment|Attention Required)/i.test(response.body)) throw Error("The source requires browser verification.");
    if (!json) return response.body;
    try {
      return JSON.parse(response.body);
    } catch {
      throw Error("The source returned invalid JSON.");
    }
  };
}

// extensions/mangadex/src/source.js
var API = "https://api.mangadex.org";
var ORIGIN = "https://mangadex.org";
var HOSTS = ["api.mangadex.org", "uploads.mangadex.org", "cmdxd98sb0x3yprd.mangadex.network"];
function id(v) {
  if (typeof v !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v)) throw Error("Invalid MangaDex identity.");
  return v;
}
function activate({ host }) {
  const read = reader(host, API);
  async function searchPage(query, options = {}) {
    const { page, limit } = pageOptions(options), q = String(query).trim().slice(0, 500), offset = (page - 1) * limit;
    if (!q || offset >= 1e4) return { items: [], hasMore: false };
    const d = await read("/manga?title=" + encodeURIComponent(q) + "&limit=" + limit + "&offset=" + offset + "&includes[]=cover_art&order[relevance]=desc&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=en&hasAvailableChapters=true", true);
    if (d.result !== "ok" || !Array.isArray(d.data)) throw Error("Invalid MangaDex search response.");
    const items = d.data.map((m) => {
      const book = id(m.id), a = m.attributes, title = text(a.title?.en || a.title?.["ja-ro"] || Object.values(a.title ?? {})[0]), file = m.relationships?.find((r) => r.type === "cover_art")?.attributes?.fileName, cover = file ? asset("https://uploads.mangadex.org/covers/" + book + "/" + encodeURIComponent(file) + ".256.jpg", ORIGIN, HOSTS, ORIGIN + "/") : null;
      return { id: book, title, url: ORIGIN + "/title/" + book, ...cover ? { cover } : {} };
    }).filter((m) => m.title);
    return { items, hasMore: d.data.length > 0 && offset + d.data.length < Math.min(Number(d.total) || 0, 1e4) };
  }
  return { searchPage, async search(q, o = {}) {
    return (await searchPage(q, { ...o, page: 1 })).items;
  }, async getChapters(value) {
    const book = id(value), found = /* @__PURE__ */ new Map();
    let offset = 0;
    for (let batch = 0; batch < 20; batch++) {
      const d = await read("/manga/" + book + "/feed?translatedLanguage[]=en&limit=500&offset=" + offset + "&order[chapter]=asc&order[volume]=asc&includeExternalUrl=0", true);
      if (d.result !== "ok" || !Array.isArray(d.data)) throw Error("Invalid MangaDex chapter response.");
      for (const row of d.data) {
        const a = row.attributes;
        if (!a || a.externalUrl || a.isUnavailable || !a.pages) continue;
        const chapter = id(row.id), number = a.chapter && /^\d+(?:\.\d+)?$/.test(a.chapter) ? a.chapter : "Special";
        found.set(chapter, { id: chapter, title: text(a.title || "Chapter " + number), number, language: a.translatedLanguage || "en", url: ORIGIN + "/chapter/" + chapter });
      }
      offset += d.data.length;
      if (!d.data.length || offset >= d.total) return [...found.values()].map((r, index) => ({ ...r, index }));
    }
    throw Error("MangaDex chapter inventory exceeds the supported API window.");
  }, async getPages(value) {
    const chapter = id(value), d = await read("/at-home/server/" + chapter + "?forcePort443=true", true);
    if (d.result !== "ok" || !/^https:\/\/[^/]+$/.test(d.baseUrl ?? "") || !/^[a-z0-9]+$/i.test(d.chapter?.hash ?? "")) throw Error("Invalid MangaDex reader metadata.");
    const files = d.chapter.data;
    if (!Array.isArray(files) || files.some((f) => typeof f !== "string" || !/^[a-z0-9._-]+$/i.test(f))) throw Error("Invalid MangaDex page filenames.");
    return pages(files.map((f) => d.baseUrl + "/data/" + d.chapter.hash + "/" + f), ORIGIN, HOSTS, ORIGIN + "/").map((p) => ({ ...p, headers: { ...p.headers, "User-Agent": "Mozilla/5.0" } }));
  } };
}
export {
  activate
};
