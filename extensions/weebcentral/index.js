// lib/manga-common.js
function text(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, key) => {
    if (key[0] !== "#") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[key.toLowerCase()];
    const number = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return number > 0 && number <= 1114111 ? String.fromCodePoint(number) : "";
  }).replace(/\s+/g, " ").trim();
}
function attrs(value) {
  const out = {};
  for (const m of String(value).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = text(m[2] ?? m[3] ?? m[4]);
  return out;
}
function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({ ...attrs(m[1]), body: m[2], text: text(m[2]), offset: m.index }));
}
function images(html) {
  return [...html.matchAll(/<img\b([^>]*)>/gi)].map((m) => attrs(m[1]));
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

// extensions/weebcentral/src/source.js
var ORIGIN = "https://weebcentral.com";
var HOSTS = ["weebcentral.com", "temp.compsci88.com", "scans-hot.planeptune.us", "hot.planeptune.us", "official.lowee.us"];
function id(v) {
  if (typeof v !== "string" || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(v)) throw Error("Invalid WeebCentral identity.");
  return v;
}
function activate({ host }) {
  const read = reader({ fetch: (r) => host.fetch({ ...r, headers: { ...r.headers, "User-Agent": "Mozilla/5.0" } }) }, ORIGIN);
  async function searchPage(query, options = {}) {
    const { page } = pageOptions(options), q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const limit = 32, offset = (page - 1) * limit, html = await read("/search/data?text=" + encodeURIComponent(q) + "&sort=Best+Match&order=Descending&limit=" + limit + "&offset=" + offset), found = /* @__PURE__ */ new Map();
    for (const a of links(html)) {
      const p = url(a.href, ORIGIN), m = /^\/series\/([0-9A-HJKMNP-TV-Z]{26})\/[^/?]+$/.exec(p?.path ?? "");
      if (p?.host !== "weebcentral.com" || !m) continue;
      const img = images(a.body)[0], title = text(img?.alt?.replace(/ cover$/i, "") || a.text);
      if (!title) continue;
      const cover = img ? asset(img.src, ORIGIN, HOSTS, ORIGIN + "/") : null;
      const old = found.get(m[1]);
      if (!old || cover) found.set(m[1], { id: m[1], title, url: p.value, ...cover ? { cover } : {} });
    }
    return { items: [...found.values()], hasMore: found.size === limit };
  }
  return { searchPage, async search(q, o = {}) {
    return (await searchPage(q, { ...o, page: 1 })).items;
  }, async getChapters(value) {
    const book = id(value), html = await read("/series/" + book + "/full-chapter-list"), rows = [];
    for (const a of links(html)) {
      const p = url(a.href, ORIGIN), m = /^\/chapters\/([0-9A-HJKMNP-TV-Z]{26})$/.exec(p?.path ?? "");
      if (p?.host !== "weebcentral.com" || !m) continue;
      const match = /\b(?:Chapter|Episode)\s+(\d+(?:\.\d+)?)/i.exec(a.text);
      if (!match) continue;
      rows.push({ id: m[1], title: match[0], number: match[1], url: p.value });
    }
    return [...new Map(rows.map((r) => [r.id, r])).values()].sort((a, b) => Number(a.number) - Number(b.number)).map((r, index) => ({ ...r, index, language: "en" }));
  }, async getPages(value) {
    const chapter = id(value), path = "/chapters/" + chapter, html = await read(path + "/images?is_prev=False&reading_style=long_strip&current_page=1"), raw = images(html).filter((a) => /Page\s+\d+/i.test(a.alt ?? "")).map((a) => a.src);
    return pages(raw, ORIGIN, HOSTS, ORIGIN + path);
  } };
}
export {
  activate
};
