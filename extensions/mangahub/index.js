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
function hasClass(attributes, name) {
  return String(attributes.class ?? "").split(/\s+/).includes(name);
}
function elements(html, tag, predicate = () => true) {
  if (!/^[a-z][a-z0-9-]*$/.test(tag)) throw Error("Invalid HTML element selector.");
  const tokens = new RegExp(`<(/?)${tag}\\b([^>]*)>`, "gi"), stack = [], rows = [];
  let match;
  while (match = tokens.exec(html)) {
    if (!match[1]) {
      if (stack.length > 1e3) throw Error("Source HTML is too deeply nested.");
      const attributes = attrs(match[2]);
      stack.push({ attributes, start: tokens.lastIndex, offset: match.index, selected: predicate(attributes) });
    } else {
      const entry = stack.pop();
      if (entry?.selected) rows.push({ ...entry, body: html.slice(entry.start, match.index) });
    }
  }
  return rows.sort((a, b) => a.offset - b.offset);
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

// extensions/mangahub/src/source.js
var ORIGIN = "https://mangahub.ru";
var HOSTS = ["mangahub.ru", "p1.statichub.org", "ty2.statichub.org", "fd1.statichub.org"];
var BOOK = /^\/title\/[a-z0-9_-]+$/i;
var CHAPTER = /^\/read\/\d+$/;
function activate({ host }) {
  const read = reader(host, ORIGIN);
  async function searchPage(query, options = {}) {
    const { page } = pageOptions(options), q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const html = await read(`/search?query=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ""}`), found = /* @__PURE__ */ new Map();
    for (const block of elements(html, "div", (a) => hasClass(a, "item-slide"))) {
      const link = links(block.body).find((link2) => hasClass(link2, "fw-medium"));
      if (!link) continue;
      const parsed = url(link.href, ORIGIN), img = images(block.body).find((img2) => hasClass(img2, "item-slide-image"));
      if (parsed?.host !== "mangahub.ru" || !BOOK.test(parsed.path) || !link.text) continue;
      found.set(parsed.path, { id: parsed.path, title: text(link.text).slice(0, 500), cover: asset(img?.["data-src"] || img?.src, ORIGIN, HOSTS, ORIGIN + "/") });
    }
    if (found.size > 400) throw Error("MangaHub returned too many search results.");
    const items = [...found.values()], hasMore = items.length > 0 && links(html).some((link) => link.rel === "next" || new RegExp(`[?&]page=${page + 1}(?:&|$)`).test(link.href ?? ""));
    return { items, hasMore };
  }
  return {
    searchPage,
    async search(query, options = {}) {
      return (await searchPage(query, { ...options, page: 1 })).items;
    },
    async getChapters(id) {
      const path = sourceId(id, ORIGIN, BOOK), html = await read(path + "/chapters"), rows = [];
      for (const link of links(html)) {
        const parsed = url(link.href, ORIGIN);
        if (parsed?.host === "mangahub.ru" && CHAPTER.test(parsed.path) && hasClass(link, "fs-2") && hasClass(link, "fw-medium")) rows.push({ id: parsed.path, title: link.text });
      }
      return chapters(rows, "ru");
    },
    async getPages(id) {
      const path = sourceId(id, ORIGIN, CHAPTER), html = await read(path);
      const urls = elements(html, "reader-scan").flatMap((block) => images(block.body).map((img) => img["data-src"] || img.src).filter(Boolean));
      return pages(urls, ORIGIN, HOSTS, ORIGIN + path);
    }
  };
}
export {
  activate
};
