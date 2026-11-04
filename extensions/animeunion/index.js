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

// lib/anime-common.js
function identity(value, pattern = /^[a-z0-9_-]+$/i) {
  if (typeof value !== "string" || !value.length || value.length > 500 || !pattern.test(value)) throw Error("Invalid anime source identity.");
  return value;
}
function mediaUrl(value, origin) {
  const p = url(value, origin);
  if (!p || p.value.length > 2048 || !p.host.includes(".") || /^[\d.]+$/.test(p.host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(p.host)) throw Error("Invalid public HTTPS media URL.");
  return p.value;
}
function request(host, origin) {
  return async (path, { json = false, full = false, method = "GET", headers = {}, body } = {}) => {
    const p = url(path, origin);
    if (!p) throw Error("Invalid source request.");
    const response = await host.fetch({ url: p.value, method, headers: { Accept: json ? "application/json" : "text/html", Referer: origin + "/", ...headers }, ...body === void 0 ? {} : { body } });
    if (response.status !== 200) throw Error(`Source returned HTTP ${response.status}.`);
    if (typeof response.body !== "string" || response.body.length > 2 * 1024 * 1024) throw Error("Source metadata exceeds its size limit.");
    if (/cf-chl-|<title[^>]*>\s*(?:Just a moment|Attention Required)/i.test(response.body)) throw Error("Source requires browser verification.");
    if (full) return response;
    if (!json) return response.body;
    try {
      return JSON.parse(response.body);
    } catch {
      throw Error("Source returned invalid JSON.");
    }
  };
}
function titles(rows, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw Error("Invalid anime search limit.");
  const found = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!row.id || !text(row.title)) continue;
    found.set(row.id, { ...row, title: text(row.title).slice(0, 500), kind: "anime" });
  }
  return [...found.values()].slice(0, limit);
}
function episodes(rows, animeId) {
  const found = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!row.id || !Number.isFinite(row.number) || row.number < 0 || row.number > 1e4) throw Error("Invalid source episode metadata.");
    found.set(row.id, { ...row, animeId, title: text(row.title ?? `Episode ${row.number}`).slice(0, 500) });
  }
  if (found.size > 5e3) throw Error("Source returned too many episodes.");
  return [...found.values()].sort((a, b) => a.number - b.number);
}
function rendition(raw, origin, { quality = "auto", type, headers, subtitles } = {}) {
  const value = mediaUrl(raw, origin), container = type ?? (/\.m3u8(?:[?#]|$)/i.test(value) ? "hls" : /\.mp4(?:[?#]|$)/i.test(value) ? "mp4" : /\.mkv(?:[?#]|$)/i.test(value) ? "mkv" : null);
  if (!container || !["hls", "mp4", "mkv"].includes(container)) throw Error("Source returned an embed page instead of playable media.");
  return { url: value, type: container, quality: String(quality).slice(0, 60) || "auto", ...headers ? { headers } : {}, ...subtitles?.length ? { subtitles } : {} };
}
function result(server, videoSources, headers) {
  if (!videoSources.length || videoSources.length > 50) throw Error("Source did not return playable media.");
  return { server, videoSources, ...headers ? { headers } : {} };
}

// lib/svelte-data.js
function decodeSvelte(payload, predicate = () => true) {
  const table = payload?.nodes?.find((node2) => node2?.type === "data" && Array.isArray(node2.data) && predicate(node2.data[0]))?.data;
  if (!Array.isArray(table) || !table.length || table.length > 5e4) throw Error("Invalid Svelte source data.");
  let budget = 1e5;
  function node(value, seen, depth) {
    if (--budget < 0 || depth > 64) throw Error("Source data exceeds its decoding limit.");
    if (Array.isArray(value)) return value.map((v) => ref(v, seen, depth + 1));
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, v] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) continue;
        out[key] = ref(v, seen, depth + 1);
      }
      return out;
    }
    return value;
  }
  function ref(value, seen = /* @__PURE__ */ new Set(), depth = 0) {
    if (Number.isInteger(value) && value >= 0 && value < table.length) {
      if (seen.has(value)) return null;
      const next = new Set(seen);
      next.add(value);
      return node(table[value], next, depth + 1);
    }
    return node(value, seen, depth + 1);
  }
  return ref(0);
}

// extensions/animeunion/src/source.js
var SITE = "https://animeunion.tv";
var API = "https://api.animeunion.tv";
function activate({ host }) {
  const read = request(host, SITE), api = request(host, API);
  return {
    async search(query, options = {}) {
      const q = String(query).trim().slice(0, 500);
      if (!q) return [];
      const data = await api("/api/v1/anime?q=" + encodeURIComponent(q) + "&limit=50", { json: true });
      if (!Array.isArray(data.data)) throw Error("Invalid AnimeUnion search results.");
      return titles(data.data.filter((row) => Number(row.episodeCount) > 0).map((row) => {
        const id = identity(row.slug);
        let cover;
        try {
          if (row.coverImage) cover = mediaUrl(row.coverImage, SITE);
        } catch {
        }
        return { id, title: row.titleEng || row.title || row.titleIta, url: SITE + "/anime/" + id, ...cover ? { cover } : {} };
      }), options.limit);
    },
    async getEpisodes(value) {
      const book = identity(value), data = await api("/api/v1/anime/" + book, { json: true }), count = Number((data.data ?? data).episodeCount);
      if (!Number.isInteger(count) || count < 1 || count > 5e3) throw Error("AnimeUnion episode inventory is missing.");
      return episodes(Array.from({ length: count }, (_, i) => ({ id: book + "|" + (i + 1), number: i + 1, url: SITE + "/anime/" + book + "/" + (i + 1) })), book);
    },
    async getStreams(value, options = {}) {
      const parts = String(value).split("|");
      if (parts.length !== 2 || !/^\d+(?:\.\d+)?$/.test(parts[1])) throw Error("Invalid AnimeUnion episode identity.");
      const [book, number] = [identity(parts[0]), parts[1]], page = decodeSvelte(await read("/anime/" + book + "/" + number + "/__data.json?x-sveltekit-invalidated=01", { json: true })), rows = page?.episode?.streamLinks;
      if (!Array.isArray(rows)) throw Error("AnimeUnion stream links are missing.");
      const results = [], headers = { Origin: SITE, Referer: SITE + "/" };
      for (const [prefix, server] of [["SUB", "Sub"], ["DUB", "Dub"]]) {
        if (options.excludeServers?.includes(server)) continue;
        const videos = [];
        for (const row of rows) {
          if (row?.isActive === false || !String(row?.language ?? "").toUpperCase().startsWith(prefix)) continue;
          const quality = String(row.quality ?? "auto").replace(/^Q_/i, "").replace(/(\d+)P$/i, "$1p");
          videos.push(rendition(row.url, SITE, { quality, headers }));
        }
        if (videos.length) results.push(result(server, [...new Map(videos.map((v) => [v.url, v])).values()], headers));
      }
      if (!results.length) throw Error("AnimeUnion has no available sub/dub stream for this episode.");
      return results;
    }
  };
}
export {
  activate
};
