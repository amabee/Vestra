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

// lib/html-manga.js
function createHtmlManga(host, config) {
  const { origin, hosts, bookPattern, chapterPattern } = config, originHost = origin.slice(8), read = reader(host, origin), searchRead = config.searchOrigin ? reader(host, config.searchOrigin) : read;
  const own = (href, pattern) => {
    const parsed = url(href, origin);
    return parsed?.host === originHost && pattern.test(parsed.path) ? parsed.path : null;
  };
  const completeImage = (raw) => typeof raw === "string" && raw.startsWith("http://") ? "https://" + raw.slice(7) : raw;
  async function searchPage(query, options = {}) {
    const { page } = pageOptions(options), q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const html = await searchRead(config.searchPath(q, page)), found = /* @__PURE__ */ new Map();
    for (const block of config.results(html)) {
      const selected = links(block).filter((link2) => own(link2.href, bookPattern));
      if (!selected.length) continue;
      const link = selected.find((link2) => link2.text) || selected[0], img = images(block)[0];
      const id = own(link.href, bookPattern), title = text(config.title?.(block) || link.title || link.text || img?.alt);
      if (!title) continue;
      found.set(id, { id, title: title.slice(0, 500), cover: asset(completeImage(img?.["data-src"] || img?.["data-original"] || img?.src), origin, hosts, origin + "/") });
    }
    if (found.size > 400) throw Error("The source returned too many search results.");
    const items = [...found.values()];
    const hasMore = items.length > 0 && (config.hasMore?.(html, page) ?? links(html).some((link) => link.rel === "next" || new RegExp(`(?:/page/${page + 1}/|[?&]page=${page + 1}(?:&|$))`).test(link.href ?? "")));
    return { items, hasMore };
  }
  return {
    searchPage,
    async search(query, options = {}) {
      return (await searchPage(query, { ...options, page: 1 })).items;
    },
    async getChapters(id) {
      const path = sourceId(id, origin, bookPattern), html = await read(config.chapterListPath?.(path) ?? path), rows = [];
      for (const link of config.chapterLinks(html, path)) {
        const chapter = own(link.href, chapterPattern);
        if (!chapter || config.belongs && !config.belongs(chapter, path)) continue;
        rows.push({ id: chapter, title: link.text || `Chapter ${chapter.match(/(?:chapter[-_/]|\/c)(\d+(?:[.-]\d+)?)/i)?.[1] ?? "Special"}` });
      }
      return chapters(rows, config.language);
    },
    async getPages(id) {
      const path = sourceId(id, origin, chapterPattern), html = await read(config.readerPath?.(path) ?? path), urls = (await config.readerImages(html, path, read)).map((img) => completeImage(typeof img === "string" ? img : img["data-src"] || img["data-original"] || img.src)).filter(Boolean);
      return pages(urls, origin, hosts, config.imageReferer?.(path) ?? origin + path);
    }
  };
}

// extensions/mangafreak/src/source.js
function activate({ host }) {
  return createHtmlManga(host, {
    origin: "https://ww3.mangafreak.me",
    hosts: ["ww3.mangafreak.me", "images.mangafreak.me", "images2.mangafreak.me"],
    language: "en",
    bookPattern: /^\/Manga\/[a-z0-9_-]+$/i,
    chapterPattern: /^\/Read\d+_[a-z0-9_.-]+$/i,
    searchPath: (q, page) => `/Find/${encodeURIComponent(q)}${page > 1 ? `/${page}` : ""}`,
    results: (html) => elements(html, "div", (a) => hasClass(a, "manga_search_item")).map((block) => block.body),
    chapterLinks: (html) => elements(html, "div", (a) => hasClass(a, "manga_series_list") || hasClass(a, "series_sub_chapter_list")).flatMap((block) => links(block.body).map((link) => ({ ...link, text: `Chapter ${link.href?.match(/_(\d+(?:\.\d+)?)$/)?.[1] ?? "Special"} ${link.text}` }))),
    belongs: (chapter, book) => chapter.toLowerCase().includes("_" + book.split("/")[2].toLowerCase() + "_"),
    readerImages: (html) => elements(html, "div", (a) => hasClass(a, "mySlides") && hasClass(a, "fade")).flatMap((block) => images(block.body))
  });
}
export {
  activate
};
