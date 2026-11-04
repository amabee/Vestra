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

// extensions/mangaball/src/source.js
var ORIGIN = "https://mangaball.com";
var HOSTS = ["mangaball.com", "bulbasaur.poke-black-and-white.net", "cdn.mangaupdates.com"];
function identity(value) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,200}$/i.test(value)) throw Error("Invalid MangaBall identity.");
  return value;
}
function activate({ host }) {
  const read = reader(host, ORIGIN);
  async function post(path, body) {
    const r = await host.fetch({ url: ORIGIN + path, method: "POST", headers: { "Content-Type": "application/json", Referer: ORIGIN + "/" }, body: JSON.stringify(body) });
    if (r.status !== 200) throw Error(`MangaBall returned HTTP ${r.status}.`);
    const data = JSON.parse(r.body);
    if (data.status !== "success") throw Error("MangaBall returned an unsuccessful response.");
    return data;
  }
  async function searchPage(query, options = {}) {
    const { page, limit } = pageOptions(options), keyword = String(query).trim().slice(0, 500);
    if (!keyword) return { items: [], hasMore: false };
    const data = await post("/api/v1/title/search", { keyword, page, limit, adult_mode: "all" });
    if (!Array.isArray(data.data) || data.data.length > 400) throw Error("Invalid MangaBall search results.");
    const last = data.pagination?.total_pages, current = data.pagination?.page;
    if (!Number.isInteger(last) || last < 0 || current !== page) throw Error("Invalid MangaBall search pagination.");
    return { items: data.data.map((row) => ({ id: identity(row._id ?? row.id), title: String(row.name).slice(0, 500), cover: asset(row.image?.file ?? row.image?.cdn_mangaupdates, ORIGIN, HOSTS, ORIGIN + "/") })), hasMore: page < last };
  }
  return {
    searchPage,
    async search(q, o = {}) {
      return (await searchPage(q, { ...o, page: 1 })).items;
    },
    async getChapters(value) {
      const book = identity(value), data = await post("/api/v1/chapter/chapter-listing-by-title-id", { title_id: book }), found = /* @__PURE__ */ new Map();
      if (!Array.isArray(data.data) || data.data.length > 1e4) throw Error("Invalid MangaBall chapter list.");
      for (const row of data.data) {
        const id = identity(row.id ?? row._id);
        if (row.title_id && row.title_id !== book) throw Error("MangaBall returned chapters for another title.");
        found.set(id, { id, title: String(row.name ?? `Chapter ${row.number}`).slice(0, 500), number: String(row.chapter_number ?? row.number ?? "Special"), language: typeof row.lang === "string" ? row.lang : void 0, scanlator: typeof row.group_name === "string" ? row.group_name : void 0 });
      }
      return [...found.values()].sort((a, b) => Number(a.number) - Number(b.number)).map((row, index) => ({ ...row, index }));
    },
    async getPages(value) {
      const id = identity(value), data = await read("/api/v1/chapter-detail?chapter_id=" + id, true);
      if (data.status !== "success") throw Error("MangaBall could not load this chapter.");
      return pages(data.data?.chapter?.pages, ORIGIN, HOSTS, ORIGIN + "/chapter-detail/" + id);
    }
  };
}
export {
  activate
};
