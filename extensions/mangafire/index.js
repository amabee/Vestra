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

// extensions/mangafire/src/request-key.js
var tables = {
  1: "yINlmUNho8VYJT+ibTIP+9ESiULpVEtMOoD6U6lRE0R/xwXo/Xp9NrUgC4cw/Lmo33vUyjUE40kUoEWIr/fxfNNcq2s79ShQ5NhNrFnJ4hXPwOu/SuXzIbuTQKGFvfm08E9jvCfqAtoDqvQq3dVWPQFmJjgvkISBeXY3BgANR+yVnjGbcxZ47d6kLNfZPIayTq3/YGySb1KuVZodWp/WGNAO5pfMcpaK53Hhs0allBszaMaxuouOwdxbwgxIw6YunSsXjI05Yi0j9j4eHKfSXR8Ifo/Od+8iamRfCXTyvm7NGRGYdcQ0ywcK/u6RXhrbcCm4t2eCtrDgQVecJGkQ+A==",
  2: "IUFltCxD3Oc2cwCgkJffthaOg9cgPUb0LgW6H/VtfcF0kc5F25t+aWj6JH9VOhOaY0rAFdUxlDnl5BLNvwEJvQtP5qcw7vdb/K+chnbwnspSHT8mz5lqwz41TezG0hkO06FTjJZhsyNuFLDpD2ZZxQj/QIRcF90zpmQ7Byu483WsQqUE0C342HL+JXngRB6fRzxRyVTaKu83h7UYTJ0QMt6ixFh6S3F8gqkKwrGTL3jHNBsD45UnifK8+RGtishQV2K3rujLKEkiZxpr2dYcudFW4oFsDKhad3CLBvuyTqsCo4B7mL5IKQ1vXo/MOOvq1I1d8ar9X6Ttu5KF4fZgiA==",
  3: "NQHlu1/wVO5EmkwQymF810qqY2xG1k2obcas4Z9mCsPEIFl9pRIjFxbJ7ybMHbBckT5Ton85E0FOeHezbh/mjlEYpmpnlXOS8dgrqeq2KfxImTh1YK9y0PeMNhzA1OQzSY9brYOJq/l2QnE/hwOeZIhPixVSKIUlDb5vLcH6RWKxkIEMuP0bDwIqQ71AJJaEaMJL7A6YtyIwoRT+L5v4aZzodN/0+3nOGsfblFjgxSfPzVDjNFeNl5P26+kEC/8AHgdrpAbt3hHz3HrRN1Y6e+JHgF7ncFWnoF0y3THL1S71WgWGCa6KtSzTCCG58n68nTyj2T3Sshk7utqCtMi/ZQ=="
};
var keys = {
  1: "0Ec58JOY3uBzJK9m3zqIOpdlF7UFiax9DmA=",
  2: "AAdjb1iPY8CiDmq9H34tKTBF8a3oDQ==",
  3: "DELOJgPsVaCcblDtTGMdHzM="
};
var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function decode(value) {
  const out = [];
  let bits = 0, n = 0;
  for (const c of value) {
    if (c === "=") break;
    const i = alphabet.indexOf(c);
    if (i < 0) throw Error("Invalid protocol table.");
    n = n << 6 | i;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push(n >> bits & 255);
    }
  }
  return out;
}
function encode(data) {
  let out = "", bits = 0, n = 0;
  for (const b of data) {
    n = n << 8 | b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += alphabet[n >> bits & 63];
    }
  }
  if (bits) out += alphabet[n << 6 - bits & 63];
  return out.replace(/\+/g, "-").replace(/\//g, "_");
}
var stages = [1, 2, 3].map((n, i) => [decode(tables[n]), decode(keys[n]), [90, 53, 186][i]]);
function sign(value) {
  let data = [];
  for (const c of encodeURIComponent(value).match(/%[0-9a-f]{2}|[^%]/gi) ?? []) data.push(c[0] === "%" ? parseInt(c.slice(1), 16) : c.charCodeAt(0));
  for (const [table, key, iv] of stages) {
    let prev = iv;
    data = data.map((byte, i) => prev = table[(byte ^ key[i % key.length] ^ prev) & 255]);
  }
  return encode(data);
}
function form(value) {
  return encodeURIComponent(value).replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, "+");
}
function signedPath(path, pairs = []) {
  if (!/^\/api\/[a-z0-9/_-]+$/i.test(path)) throw Error("Invalid MangaFire API path.");
  const sorted = pairs.map((p) => [...p]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  let last = "", index = 0;
  const canonical = path.slice(4) + (sorted.length ? "?" + sorted.map(([k, v]) => {
    let name = k;
    if (k.endsWith("[]")) {
      if (last !== k) index = 0;
      last = k;
      name = k.slice(0, -2) + "[" + index++ + "]";
    }
    return name + "=" + v;
  }).join("&") : "");
  return path + "?" + [...sorted, ["vrf", sign(canonical)]].map(([k, v]) => form(k) + "=" + form(String(v))).join("&");
}

// extensions/mangafire/src/source.js
var ORIGIN = "https://mangafire.to";
var HOSTS = ["mangafire.to", "static.mfcdn.nl", "k99.mfcdn1.xyz"];
function identity(value) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,200}$/i.test(value)) throw Error("Invalid MangaFire identity.");
  return value;
}
function activate({ host }) {
  const read = reader(host, ORIGIN), api = (path, pairs = []) => read(signedPath("/api" + path, pairs), true);
  async function searchPage(query, options = {}) {
    const { page, limit } = pageOptions(options), q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const data = await api("/titles", [["keyword", q], ["content_rating[]", "safe"], ["content_rating[]", "suggestive"], ["content_rating[]", "erotica"], ["order[relevance]", "desc"], ["page", String(page)], ["limit", String(limit)]]);
    if (!Array.isArray(data.items) || data.items.length > 400) throw Error("Invalid MangaFire search results.");
    const last = data.meta?.lastPage;
    if (!Number.isInteger(last) || last < 0) throw Error("MangaFire search pagination is missing.");
    return { items: data.items.map((row) => ({ id: identity(row.hid), title: String(row.title).slice(0, 500), cover: asset(row.poster?.large, ORIGIN, HOSTS, ORIGIN + "/") })), hasMore: page < last };
  }
  return {
    searchPage,
    async search(q, o = {}) {
      return (await searchPage(q, { ...o, page: 1 })).items;
    },
    async getChapters(value) {
      const book = identity(value), data = await api("/titles/" + book), languages = data.data?.languages, found = /* @__PURE__ */ new Map();
      if (!Array.isArray(languages) || languages.length > 40) throw Error("Invalid MangaFire title languages.");
      for (const language of [...new Set(languages)]) {
        if (typeof language !== "string" || !/^[a-z-]{2,12}$/.test(language)) throw Error("Invalid MangaFire language.");
        let total = 1;
        for (let page = 1; page <= total; page++) {
          const result = await api(`/titles/${book}/chapters`, [["language", language], ["sort", "number"], ["order", "asc"], ["page", String(page)], ["limit", "200"]]);
          total = result.meta?.lastPage;
          if (!Array.isArray(result.items) || !Number.isInteger(total) || total < 0 || total > 100) throw Error("Invalid MangaFire chapter pagination.");
          let added = 0;
          for (const row of result.items) {
            const id = identity(String(row.id));
            if (!found.has(id)) {
              found.set(id, { id, title: typeof row.name === "string" && row.name.trim() && !row.name.startsWith("(1r0n)") ? row.name.slice(0, 500) : `Chapter ${row.number}`, number: String(row.number ?? "Special"), language: language === "es-la" ? "es-419" : language, scanlator: typeof row.type === "string" ? row.type : void 0 });
              added++;
            }
          }
          if (found.size > 1e4 || page > 1 && !added) throw Error("MangaFire pagination repeated or exceeded its limit.");
        }
      }
      return [...found.values()].sort((a, b) => Number(a.number) - Number(b.number)).map((row, index) => ({ ...row, index }));
    },
    async getPages(value) {
      const data = await api("/chapters/" + identity(value));
      return pages(data.data?.pages?.map((p) => p.url), ORIGIN, HOSTS, ORIGIN + "/");
    }
  };
}
export {
  activate
};
