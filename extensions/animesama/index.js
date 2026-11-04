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

// extensions/animesama/src/source.js
var ORIGIN = "https://anime-sama.to";
var HOSTS = ["anime-sama.to", "raw.githubusercontent.com"];
function slug(value) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,200}$/i.test(value)) throw Error("Invalid AnimeSama title identity.");
  return value;
}
function panel(value) {
  if (typeof value !== "string" || !/^scan[a-z0-9_-]*\/vf$/i.test(value)) throw Error("Invalid AnimeSama scan panel.");
  return value;
}
function oeuvre(html) {
  const raw = /<[^>]*\bid=["']titreOeuvre["'][^>]*>([^<]*)/i.exec(html)?.[1];
  if (!raw || !raw.trim() || raw.length > 500) throw Error("AnimeSama scan title is missing.");
  return raw.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"');
}
function activate({ host }) {
  const read = reader(host, ORIGIN), titles = /* @__PURE__ */ new Map();
  async function work(book, scan) {
    const key = book + "|" + scan, hit = titles.get(key);
    if (hit && hit.until > Date.now()) return hit.title;
    const title = oeuvre(await read(`/catalogue/${book}/${scan}/`));
    if (titles.size >= 32) titles.delete(titles.keys().next().value);
    titles.set(key, { title, until: Date.now() + 6e4 });
    return title;
  }
  async function counts(title) {
    const data = await read(`/s2/scans/get_nb_chap_et_img.php?oeuvre=${encodeURIComponent(title)}`, true);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("AnimeSama returned invalid chapter counts.");
    return data;
  }
  async function searchPage(query, options = {}) {
    const { page } = pageOptions(options), q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const response = await host.fetch({ url: ORIGIN + "/template-php/defaut/fetch.php", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: ORIGIN + "/" }, body: `query=${encodeURIComponent(q)}&page=${page}` });
    if (response.status !== 200) throw Error(`AnimeSama search returned HTTP ${response.status}.`);
    const found = /* @__PURE__ */ new Map();
    for (const link of links(response.body)) {
      if (!hasClass(link, "asn-search-result") || !elements(link.body, "p", (a) => hasClass(a, "asn-search-meta")).some((p2) => /scans/i.test(text(p2.body)))) continue;
      const p = url(link.href, ORIGIN), match = /^\/catalogue\/([a-z0-9_-]+)\/?$/i.exec(p?.path ?? "");
      if (p?.host !== "anime-sama.to" || !match) continue;
      const title = text(elements(link.body, "h3", (a) => hasClass(a, "asn-search-result-title"))[0]?.body), img = images(link.body)[0];
      if (title) found.set(match[1], { id: match[1], title: title.slice(0, 500), cover: asset(img?.src, ORIGIN, HOSTS, ORIGIN + "/") });
    }
    if (found.size > 400) throw Error("AnimeSama returned too many search results.");
    return { items: [...found.values()], hasMore: false };
  }
  return {
    searchPage,
    async search(q, o = {}) {
      return (await searchPage(q, { ...o, page: 1 })).items;
    },
    async getChapters(id) {
      const book = slug(id), html = await read(`/catalogue/${book}/`), found = /* @__PURE__ */ new Map();
      for (const match of html.matchAll(/panneauScan\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/g)) {
        if (!/^scan[a-z0-9_-]*\/vf$/i.test(match[2])) continue;
        const scan = panel(match[2]);
        if (found.size >= 1e4) throw Error("AnimeSama returned too many chapters.");
        const name = await work(book, scan), data = await counts(name);
        for (const [number, count] of Object.entries(data)) {
          if (!/^[a-z0-9_.-]{1,100}$/i.test(number) || !Number.isInteger(count) || count < 0 || count > 2e3) throw Error("AnimeSama returned invalid chapter metadata.");
          if (!count) continue;
          const chapter = `${book}|${scan}|${number}`;
          found.set(chapter, { id: chapter, title: `Chapitre ${number} \u2014 ${text(match[1])}`, number, language: "fr", scanlator: text(match[1]).slice(0, 500) });
        }
      }
      return [...found.values()].sort((a, b) => {
        const x = Number(a.number), y = Number(b.number);
        return Number.isFinite(x) && Number.isFinite(y) ? x - y : 0;
      }).map((row, index) => ({ ...row, index }));
    },
    async getPages(id) {
      const parts = String(id).split("|");
      if (parts.length !== 3 || !/^[a-z0-9_.-]{1,100}$/i.test(parts[2])) throw Error("Invalid AnimeSama chapter identity.");
      const [book, scan, number] = [slug(parts[0]), panel(parts[1]), parts[2]], title = await work(book, scan), data = await counts(title), count = data[number];
      if (!Number.isInteger(count) || count < 1 || count > 2e3) throw Error("AnimeSama chapter is unavailable.");
      return pages(Array.from({ length: count }, (_, i) => `${ORIGIN}/s2/scans/${encodeURIComponent(title)}/${encodeURIComponent(number)}/${i + 1}.jpg`), ORIGIN, HOSTS, ORIGIN + "/");
    }
  };
}
export {
  activate
};
