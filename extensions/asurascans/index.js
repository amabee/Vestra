/*
MIT License

Copyright (c) 2025 Pal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

// lib/manga-common.js
function text(value2) {
  return String(value2 ?? "").replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, key) => {
    if (key[0] !== "#") return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[key.toLowerCase()];
    const number = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return number > 0 && number <= 1114111 ? String.fromCodePoint(number) : "";
  }).replace(/\s+/g, " ").trim();
}
function attrs(value2) {
  const out = {};
  for (const m of String(value2).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = text(m[2] ?? m[3] ?? m[4]);
  return out;
}
function links(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({ ...attrs(m[1]), body: m[2], text: text(m[2]), offset: m.index }));
}
function url(raw, origin) {
  let value2 = String(raw ?? "").replace(/&amp;/g, "&").trim();
  if (value2.startsWith("//")) value2 = "https:" + value2;
  else if (value2.startsWith("/")) value2 = origin + value2;
  if (value2.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value2)) return null;
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(\/[^#]*)?$/i.exec(value2);
  if (!match) return null;
  let decoded;
  try {
    decoded = decodeURIComponent((match[2] ?? "/").split("?")[0]);
  } catch {
    return null;
  }
  if (/(?:^|\/)\.{1,2}(?:\/|$)|[\\\u0000-\u001f]/.test(decoded)) return null;
  return { value: value2, host: match[1].toLowerCase(), path: match[2] ?? "/" };
}
function sourceId(raw, origin, pattern) {
  const parsed = url(raw, origin);
  if (!parsed || parsed.value !== origin + parsed.path || !pattern.test(parsed.path)) throw Error("Invalid identity for this manga source.");
  return parsed.path;
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
function chapters(rows, language) {
  const unique = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!row.id || unique.has(row.id)) continue;
    const match = String(row.title).match(/(?:chapter|chapitre|cap[ií]tulo|глава|ch\.?)[\s.:-]*(\d+(?:[.-]\d+)?)/i) ?? String(row.id).match(/(?:chapter[-/]|\/c)(\d+(?:[.-]\d+)?)/i);
    const number = match ? match[1].replace("-", ".") : "Special";
    unique.set(row.id, { id: row.id, title: text(row.title).slice(0, 500), number, language });
  }
  if (unique.size > 1e4) throw Error("The source returned too many chapters.");
  return [...unique.values()].sort((a, b) => {
    const an = Number(a.number), bn = Number(b.number);
    return Number.isFinite(an) && Number.isFinite(bn) ? an - bn : Number.isFinite(an) ? -1 : Number.isFinite(bn) ? 1 : 0;
  }).map((row, index) => ({ ...row, index }));
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

// extensions/asurascans/src/source.js
var ORIGIN = "https://asurascans.com";
var HOSTS = ["asurascans.com", "cdn.asurascans.com"];
var BOOK = /^\/comics\/[a-z0-9_-]+$/i;
var CHAPTER = /^\/comics\/[a-z0-9_-]+\/chapter\/\d+(?:\.\d+)?$/i;
function props(html, name) {
  for (const match of html.matchAll(/<astro-island\b([^>]*)>/gi)) {
    const a = attrs(match[1]);
    if (!(a["component-url"] ?? a.opts ?? "").includes(name) && !(a.opts ?? "").includes(name)) continue;
    try {
      return JSON.parse(a.props);
    } catch {
      throw Error("AsuraScans returned invalid reader data.");
    }
  }
  throw Error(`AsuraScans ${name} metadata is missing.`);
}
function value(encoded) {
  return Array.isArray(encoded) && encoded[0] === 0 ? encoded[1] : encoded;
}
function array(encoded) {
  if (!Array.isArray(encoded) || encoded[0] !== 1 || !Array.isArray(encoded[1])) throw Error("AsuraScans returned invalid list data.");
  return encoded[1].map(value);
}
function activate({ host }) {
  const read = reader(host, ORIGIN);
  async function searchPage(query, options = {}) {
    const { page } = pageOptions(options), q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const html = await read(`/browse?search=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ""}`), data = props(html, "BrowseFilters"), seen = /* @__PURE__ */ new Set();
    const items = array(data.initialSeries).flatMap((row) => {
      const id = value(row.public_url) || `/comics/${value(row.slug)}`, parsed = url(id, ORIGIN), title = value(row.title);
      if (parsed?.host !== "asurascans.com" || !BOOK.test(parsed.path) || typeof title !== "string" || !title.trim() || seen.has(parsed.path)) return [];
      seen.add(parsed.path);
      return [{ id: parsed.path, title: text(title).slice(0, 500), cover: asset(value(row.cover), ORIGIN, HOSTS, ORIGIN + "/") }];
    });
    if (items.length > 400) throw Error("AsuraScans returned too many search results.");
    const totalPages = value(data.initialTotalPages), currentPage = value(data.initialCurrentPage);
    if (totalPages !== void 0 && (!Number.isInteger(totalPages) || totalPages < 0 || totalPages > 1e3)) throw Error("AsuraScans returned invalid pagination.");
    if (currentPage !== void 0 && currentPage !== page) throw Error("AsuraScans returned the wrong search page.");
    const hasMore = Number.isInteger(totalPages) ? page < totalPages : links(html).some((link) => link.rel === "next" || new RegExp(`[?&]page=${page + 1}(?:&|$)`).test(link.href ?? ""));
    return { items, hasMore };
  }
  return {
    searchPage,
    async search(query, options = {}) {
      return (await searchPage(query, { ...options, page: 1 })).items;
    },
    async getChapters(id) {
      const path = sourceId(id, ORIGIN, BOOK), html = await read(path);
      if (html.includes("ChapterListReact")) {
        const data = props(html, "ChapterListReact"), rows = array(data.chapters).flatMap((row) => {
          const number = value(row.number);
          if (typeof number !== "number" || !Number.isFinite(number) || number < 0) return [];
          const id2 = path + "/chapter/" + number;
          if (!CHAPTER.test(id2)) return [];
          const until = Date.parse(value(row.early_access_until)), premium = value(row.is_premium) === true, locked = premium && (!Number.isFinite(until) || until > Date.now()), label = locked ? Number.isFinite(until) ? " \xB7 Early access" : " \xB7 Premium" : "", name = text(value(row.title));
          return [{ id: id2, url: ORIGIN + id2, title: "Chapter " + number + (name ? " \xB7 " + name : "") + label }];
        });
        return chapters(rows, "en");
      }
      return chapters(links(html).flatMap((link) => {
        const p = url(link.href, ORIGIN);
        return p?.host === "asurascans.com" && p.path.startsWith(path + "/chapter/") && CHAPTER.test(p.path) ? [{ id: p.path, title: link.text || `Chapter ${p.path.split("/").pop()}` }] : [];
      }), "en");
    },
    async getPages(id) {
      const path = sourceId(id, ORIGIN, CHAPTER), html = await read(path), data = props(html, "ChapterReader");
      if (value(data.isLocked) === true) throw Error("AsuraScans has locked this chapter for early access. Choose an unlocked chapter or try again after it becomes public.");
      const rows = array(data.pages);
      if (!rows.length) throw Error("AsuraScans has not published images for this chapter yet. Choose another chapter or try again later.");
      return pages(rows.map((row) => value(row.url)), ORIGIN, HOSTS, ORIGIN + path);
    }
  };
}
export {
  activate
};
