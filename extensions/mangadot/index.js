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

// extensions/mangadot/src/source.js
var ORIGIN = "https://mangadot.net";
var HOSTS = ["mangadot.net"];
function identity(value) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,200}$/i.test(value)) throw Error("Invalid MangaDot identity.");
  return value;
}
function activate({ host }) {
  const read = reader(host, ORIGIN);
  async function searchPage(query, options = {}) {
    const { page, limit } = pageOptions(options), q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const data = await read(`/api/search?search=${encodeURIComponent(q)}&sortBy=relevance&sortOrder=desc&limit=${limit}&page=${page}`, true);
    if (!Array.isArray(data.manga_list) || data.manga_list.length > 400) throw Error("Invalid MangaDot search results.");
    const total = data.total ?? data.pagination?.total;
    return { items: data.manga_list.map((row) => ({ id: identity(String(row.id)), title: String(row.title).slice(0, 500), cover: asset(row.photo, ORIGIN, HOSTS, ORIGIN + "/") })), hasMore: typeof data.has_more === "boolean" ? data.has_more : Number.isInteger(total) ? page * limit < total : false };
  }
  return {
    searchPage,
    async search(q, o = {}) {
      return (await searchPage(q, { ...o, page: 1 })).items;
    },
    async getChapters(value) {
      const book = identity(value), data = await read(`/api/manga/${book}/chapters/list`, true);
      if (!Array.isArray(data) || data.length > 1e4) throw Error("Invalid MangaDot chapter list.");
      const found = /* @__PURE__ */ new Map();
      for (const row of data) {
        const id = identity(String(row.id));
        found.set(id, { id, title: String(row.chapter_title ?? `Chapter ${row.chapter_number}`).slice(0, 500), number: String(row.chapter_number ?? "Special"), language: typeof row.language === "string" ? row.language : void 0, scanlator: typeof row.group_name === "string" ? row.group_name : void 0 });
      }
      return [...found.values()].sort((a, b) => Number(a.number) - Number(b.number)).map((row, index) => ({ ...row, index }));
    },
    async getPages(value) {
      const id = identity(value), data = await read(`/api/uploads/${id}/images`, true);
      if (!data.images || typeof data.images !== "object" || Array.isArray(data.images)) throw Error("Invalid MangaDot images.");
      const entries = Object.entries(data.images);
      if (entries.some(([key]) => !/^\d+$/.test(key))) throw Error("Invalid MangaDot image ordering.");
      return pages(entries.sort((a, b) => Number(a[0]) - Number(b[0])).map(([, row]) => row.url), ORIGIN, HOSTS, ORIGIN + "/");
    }
  };
}
export {
  activate
};
