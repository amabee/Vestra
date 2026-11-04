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

// lib/rsc-data.js
function flightData(html) {
  let data = "";
  for (const match of html.matchAll(/self\.__next_f\.push\((\[1,"(?:[^"\\]|\\.)*"\])\)/g)) {
    try {
      data += JSON.parse(match[1])[1];
    } catch {
      throw Error("Invalid serialized reader data.");
    }
  }
  return data;
}
function jsonArray(data, key) {
  const match = new RegExp('"' + key + '"\\s*:\\s*\\[').exec(data);
  if (!match) throw Error("Reader page data is missing.");
  const start = match.index + match[0].length - 1;
  let depth = 0, quoted = false, escape = false;
  for (let i = start; i < data.length; i++) {
    const c = data[i];
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) {
      try {
        return JSON.parse(data.slice(start, i + 1));
      } catch {
        break;
      }
    }
  }
  throw Error("Invalid reader page array.");
}

// extensions/xcomic/src/source.js
var ORIGIN = "https://xcomic.me";
var HOSTS = [
  "xcomic.me",
  "cdn.mangabaka.dev",
  "i00.img00.org",
  "i00.img01.org",
  "i00.img02.org",
  "i01.img00.org",
  "i01.img01.org",
  "i02.img02.org",
  "i03.img01.org",
  "i04.img01.org",
  "i05.img01.org",
  "i06.img00.org",
  "i06.img02.org",
  "i07.img00.org",
  "i07.img01.org",
  "i07.img02.org",
  "i08.img00.org",
  "i08.img01.org",
  "i09.img00.org",
  "i09.img01.org"
];
function identity(value) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,200}$/i.test(value))
    throw Error("Invalid xComic identity.");
  return value;
}
function activate({ host }) {
  const read = reader(host, ORIGIN), cache = /* @__PURE__ */ new Map();
  async function readPage(q, page) {
    const key = q + "|" + page, hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await fetchPage(q, page);
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: Date.now() + 2e4 });
    return value;
  }
  async function searchPage(query, options = {}) {
    const { page } = pageOptions(options), q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const current = await readPage(q, page);
    if (current.hasMore || !current.items.length || page === 1e3)
      return current;
    const next = await readPage(q, page + 1), ids = new Set(current.items.map((i) => i.id));
    return {
      items: current.items,
      hasMore: next.items.some((i) => !ids.has(i.id))
    };
  }
  async function fetchPage(q, page) {
    const html = await read(
      `/search?word=${encodeURIComponent(q)}&sortby=score&page=${page}`
    ), found = /* @__PURE__ */ new Map();
    for (const a of links(html)) {
      const p = url(a.href, ORIGIN), match = /^\/title\/([a-z0-9_-]+)$/.exec(p?.path ?? "");
      if (p?.host !== "xcomic.me" || !match || images(a.body).length) continue;
      const title = text(a.body);
      if (!title) continue;
      const preceding = html.slice(Math.max(0, a.offset - 1600), a.offset), img = images(preceding).pop();
      found.set(match[1], {
        id: match[1],
        title: title.slice(0, 500),
        cover: asset(img?.src, ORIGIN, HOSTS, ORIGIN + "/")
      });
    }
    if (found.size > 400) throw Error("xComic returned too many results.");
    const hasMore = links(html).some((a) => {
      const p = url(a.href, ORIGIN);
      return p?.host === "xcomic.me" && p.path.startsWith("/search?") && new RegExp("(?:[?&])page=" + String(page + 1) + "(?:&|$)").test(p.path);
    });
    return { items: [...found.values()], hasMore };
  }
  return {
    searchPage,
    async search(q, o = {}) {
      return (await searchPage(q, { ...o, page: 1 })).items;
    },
    async getChapters(value) {
      const book = identity(value), html = await read("/title/" + book), sources = [], sourceLinks = links(html).filter((a) => /^\/source\//.test(a.href));
      for (const [i, a] of sourceLinks.entries()) {
        const p = url(a.href, ORIGIN), m = /^\/source\/([a-z0-9_-]+)$/.exec(p?.path ?? "");
        if (p?.host !== "xcomic.me" || !m) continue;
        const next = sourceLinks[i + 1]?.offset ?? -1, card = html.slice(a.offset, next < 0 ? html.length : next), label = text(a.body), before = html.slice(Math.max(0, a.offset - 180), a.offset), language = label + " " + ([...before.matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)].pop()?.[0] ?? "");
        if (!/🇬🇧|🇺🇸|🇨🇦|🇦🇺|🇳🇿|🇮🇪|\bEnglish\b/u.test(language)) continue;
        const count = Number(
          (text(card).match(/([\d,]+)\s+chapters?/i)?.[1] ?? "0").replace(
            /,/g,
            ""
          )
        );
        sources.push({ id: m[1], count });
      }
      if (!sources.length) return [];
      sources.sort((a, b) => b.count - a.count);
      const source = sources[0], body = await read("/source/" + source.id), rows = [];
      for (const a of links(body)) {
        const p = url(a.href, ORIGIN), m = /^\/chapter\/([a-z0-9_-]+)$/.exec(p?.path ?? "");
        if (p?.host === "xcomic.me" && m)
          rows.push({ id: m[1], title: text(a.body) });
      }
      return chapters(rows, "en");
    },
    async getPages(value) {
      const chapter = identity(value), path = "/chapter/" + chapter, html = await read(path);
      let raw;
      const flight = flightData(html);
      if (flight.includes('"imageUrls"')) raw = jsonArray(flight, "imageUrls");
      else {
        const qwik = /<script\b[^>]*type=["']qwik\/(?:state|json)["'][^>]*>([\s\S]*?)<\/script>/i.exec(
          html
        )?.[1];
        if (!qwik) throw Error("xComic reader data is missing.");
        const data = qwik.replace(/"imageUrls",\d+,\[/, '"imageUrls":[');
        raw = jsonArray(data, "imageUrls");
        if (raw.some((v) => v !== 0 && typeof v !== "string"))
          throw Error("Invalid xComic serialized images.");
        raw = raw.filter((v) => typeof v === "string");
      }
      return pages(raw, ORIGIN, HOSTS, ORIGIN + path);
    }
  };
}
export {
  activate
};
