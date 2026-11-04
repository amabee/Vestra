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

// extensions/atsumaru/src/source.js
var ORIGIN = "https://atsu.moe";
var CDN = "https://cdn.atsu.moe";
var HOSTS = ["atsu.moe", "cdn.atsu.moe"];
function identity(id) {
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,100}$/i.test(id)) throw Error("Invalid Atsumaru identity.");
  return id;
}
function image(raw) {
  return typeof raw === "string" && raw.startsWith("/") ? CDN + raw : raw;
}
function activate({ host }) {
  const read = reader(host, ORIGIN);
  async function searchPage(query, options = {}) {
    const { page, limit } = pageOptions(options), q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const data = await read(`/collections/manga/documents/search?q=${encodeURIComponent(q)}&query_by=title%2CenglishTitle%2CotherNames&page=${page}&per_page=${limit}`, true);
    if (!Array.isArray(data?.hits) || !Number.isInteger(data.found) || data.found < 0 || data.page !== page) throw Error("Atsumaru returned invalid search pagination.");
    const seen = /* @__PURE__ */ new Set();
    const items = data.hits.flatMap((hit) => {
      const d = hit.document;
      if (!d || typeof d.id !== "string" || !/^[a-z0-9_-]{1,100}$/i.test(d.id) || typeof d.title !== "string" || !d.title.trim() || seen.has(d.id)) return [];
      seen.add(d.id);
      return [{ id: d.id, title: text(d.title).slice(0, 500), cover: asset(image(d.posterMedium || d.poster), ORIGIN, HOSTS, ORIGIN + "/") }];
    });
    return { items, hasMore: page * limit < data.found };
  }
  return {
    searchPage,
    async search(query, options = {}) {
      return (await searchPage(query, { ...options, page: 1 })).items;
    },
    async getChapters(id) {
      identity(id);
      const data = await read(`/api/manga/allChapters?mangaId=${encodeURIComponent(id)}`, true);
      if (!Array.isArray(data?.chapters)) throw Error("Atsumaru returned invalid chapters.");
      return chapters(data.chapters.map((row) => {
        identity(row.id);
        const n = String(row.number);
        return { id: `${id}|${row.id}`, title: `Chapter ${n}${row.title ? ` \u2014 ${text(row.title)}` : ""}` };
      }), "en");
    },
    async getPages(id) {
      if (typeof id !== "string") throw Error("Invalid Atsumaru chapter identity.");
      const parts = id.split("|");
      if (parts.length !== 2) throw Error("Invalid Atsumaru chapter identity.");
      const [book, chapter] = parts.map(identity);
      const data = await read(`/api/read/chapter?mangaId=${encodeURIComponent(book)}&chapterId=${encodeURIComponent(chapter)}`, true);
      const entries = data?.readChapter?.pages;
      if (!Array.isArray(entries) || entries.some((row) => !Number.isFinite(row.number))) throw Error("Atsumaru returned invalid pages.");
      return pages([...entries].sort((a, b) => a.number - b.number).map((row) => image(row.image)), ORIGIN, HOSTS, `${ORIGIN}/read/${book}/${chapter}`);
    }
  };
}
export {
  activate
};
