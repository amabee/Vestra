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

// extensions/taiyo/src/source.js
var ORIGIN = "https://taiyo.moe";
var CDN = "https://cdn.taiyo.moe";
var HOSTS = ["taiyo.moe", "cdn.taiyo.moe"];
var SEARCH_KEY = "48aa86f73de09a7705a2938a1a35e5a12cff6519695fcad395161315182286e5";
function identity(value) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,200}$/i.test(value)) throw Error("Invalid Taiyo identity.");
  return value;
}
function activate({ host }) {
  const read = reader(host, ORIGIN);
  async function searchPage(query, options = {}) {
    const { page, limit } = pageOptions(options), q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const response = await host.fetch({ url: "https://meilisearch.taiyo.moe/multi-search", method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SEARCH_KEY}` }, body: JSON.stringify({ queries: [{ indexUid: "medias", q, filter: ["deletedAt IS NULL"], limit, offset: (page - 1) * limit }] }) });
    if (response.status !== 200) throw Error(`Taiyo search returned HTTP ${response.status}.`);
    const data = JSON.parse(response.body)?.results?.[0];
    if (!Array.isArray(data?.hits) || data.hits.length > 400) throw Error("Invalid Taiyo search response.");
    const items = data.hits.map((hit) => {
      const id = identity(hit.id), title = hit.titles?.find((t) => t.isMainTitle)?.title ?? hit.titles?.[0]?.title;
      if (typeof title !== "string" || !title.trim()) throw Error("Taiyo title is missing.");
      return { id, title: title.slice(0, 500), cover: hit.mainCoverId ? asset(`${CDN}/medias/${id}/covers/${identity(hit.mainCoverId)}.jpg`, ORIGIN, HOSTS, ORIGIN + "/") : null };
    });
    const total = data.totalHits ?? data.estimatedTotalHits;
    if (!Number.isInteger(total) || total < 0) throw Error("Taiyo search pagination is missing.");
    return { items, hasMore: page * limit < total };
  }
  return {
    searchPage,
    async search(q, o = {}) {
      return (await searchPage(q, { ...o, page: 1 })).items;
    },
    async getChapters(value) {
      const book = identity(value), found = /* @__PURE__ */ new Map();
      let total = 1;
      for (let page = 1; page <= total; page++) {
        const input = encodeURIComponent(JSON.stringify({ "0": { json: { mediaId: book, page, perPage: 100 } } })), data = await read(`/api/trpc/chapters.getByMediaId?batch=1&input=${input}`, true), envelope = Array.isArray(data) ? data[0] : data;
        const result = envelope?.result?.data?.json ?? envelope?.result?.data;
        if (!Array.isArray(result?.chapters)) throw Error("Invalid Taiyo chapter response.");
        total = result.totalPages ?? result.pagination?.totalPages ?? 1;
        if (!Number.isInteger(total) || total < 1 || total > 100) throw Error("Invalid Taiyo chapter pagination.");
        let added = 0;
        for (const c of result.chapters) {
          const id = book + "|" + identity(c.id);
          if (!found.has(id)) {
            found.set(id, { id, title: String(c.title ?? `Cap\xEDtulo ${c.number}`).slice(0, 500), number: String(c.number ?? "Special"), language: "pt" });
            added++;
          }
        }
        if (found.size > 1e4 || page > 1 && !added) throw Error("Taiyo chapter pagination repeated or exceeded its limit.");
      }
      return [...found.values()].sort((a, b) => Number(a.number) - Number(b.number)).map((c, index) => ({ ...c, index }));
    },
    async getPages(value) {
      const ids = String(value).split("|");
      if (ids.length !== 2) throw Error("Invalid Taiyo chapter identity.");
      const [book, chapter] = ids.map(identity), path = `/chapter/${chapter}/1`, rows = jsonArray(flightData(await read(path)), "pages");
      return pages(rows.map((p) => {
        const ext = p.extension ?? "jpg";
        if (!/^(jpg|jpeg|png|webp|avif|gif)$/i.test(ext)) throw Error("Unsupported Taiyo image extension.");
        return `${CDN}/medias/${book}/chapters/${chapter}/${identity(p.id)}.${ext}`;
      }), ORIGIN, HOSTS, ORIGIN + path);
    }
  };
}
export {
  activate
};
