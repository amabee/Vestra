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

// extensions/shiro/src/source.js
var ORIGIN = "https://anv.to";
var API = "https://graphql.anilist.co";
function slugify(v) {
  return String(v).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "anime";
}
function activate({ host }) {
  const read = request(host, ORIGIN);
  async function gql(query, variables) {
    const data = await read(API, { method: "POST", json: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
    if (data.errors?.length) throw Error("Shiro catalogue request failed.");
    return data.data;
  }
  return {
    async search(query, options = {}) {
      const q = String(query).trim().slice(0, 500);
      if (!q) return [];
      const data = await gql("query($search:String){Page(perPage:50){media(search:$search,type:ANIME,sort:SEARCH_MATCH){id title{english romaji native}}}}", { search: q });
      return titles((data?.Page?.media ?? []).filter((m) => Number.isSafeInteger(m.id) && m.id > 0).map((m) => ({ id: String(m.id), title: m.title?.english || m.title?.romaji || m.title?.native, url: ORIGIN + "/anime/" + m.id + "-" + slugify(m.title?.english || m.title?.romaji || m.title?.native) })), options.limit);
    },
    async getEpisodes(value) {
      const id = identity(value, /^[1-9]\d{0,8}$/), data = await gql("query($id:Int){Media(id:$id,type:ANIME){id title{english romaji native} episodes nextAiringEpisode{episode}}}", { id: Number(id) }), m = data?.Media;
      if (!m || String(m.id) !== id) throw Error("Shiro title metadata is unavailable.");
      const known = Number(m.episodes), next = Number(m.nextAiringEpisode?.episode), released = Number.isInteger(next) && next >= 1 ? next - 1 : null, count = Number.isInteger(known) && known > 0 ? released === null ? known : Math.min(known, released) : released ?? 0;
      if (count > 5e3) throw Error("Shiro episode inventory exceeds its limit.");
      const slug = slugify(m.title?.english || m.title?.romaji || m.title?.native);
      return episodes(Array.from({ length: count }, (_, i) => ({ id: id + ":" + (i + 1) + ":" + slug, number: i + 1, url: ORIGIN + "/anime/" + id + "-" + slug + "/" + (i + 1) })), id);
    },
    async getStreams(value, options = {}) {
      const id = identity(value, /^[1-9]\d{0,8}:[1-9]\d{0,3}:[a-z0-9-]+$/), [media, number, slug] = id.split(":"), watch = ORIGIN + "/anime/" + media + "-" + slug + "/" + number, response = await read(watch, { full: true }), setCookie = Object.entries(response.headers ?? {}).find(([k]) => k.toLowerCase() === "set-cookie")?.[1] ?? "", match = /(?:^|,\s*)(shiro_watch|shiro-watch)=([^;,\s\r\n]{1,4000})/.exec(setCookie);
      if (!match) throw Error("Shiro did not return its public watch cookie. Browser verification is unsupported.");
      const cookie = match[1] + "=" + match[2], data = await read("/api/episode", { json: true, method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: ORIGIN, Referer: watch }, body: JSON.stringify({ anilistId: Number(media), episode: Number(number) }) });
      if (data.status !== "ready") throw Error("Shiro episode is not ready.");
      const grouped = /* @__PURE__ */ new Map();
      for (const variant of data.variants ?? []) {
        const key = String(variant.id || variant.label || "").toLowerCase(), server = key === "sub" ? "Sub" : key === "dub" ? "Dub" : null;
        if (!server || options.excludeServers?.includes(server)) continue;
        const videos = grouped.get(server) ?? [];
        for (const source of variant.sources ?? []) {
          if (!source?.url) continue;
          const parsed = url(source.url, ORIGIN), headers = { Referer: watch, ...parsed?.host === "anv.to" ? { Cookie: cookie } : {} }, subtitles = [];
          for (const [i, t] of (source.tracks ?? []).entries()) {
            if (!t?.src) continue;
            try {
              subtitles.push({ id: String(t.id ?? "track-" + i), url: mediaUrl(t.src, ORIGIN), language: String(t.language || "und"), label: text(t.label || t.language || "Subtitle"), isDefault: Boolean(t.default) });
            } catch {
            }
          }
          try {
            videos.push(rendition(source.url, ORIGIN, { type: /^(?:hls|m3u8|application\/vnd\.apple\.mpegurl)$/i.test(source.type ?? "") ? "hls" : source.type === "video/mp4" ? "mp4" : void 0, quality: source.label || variant.label || "auto", headers, subtitles }));
          } catch {
          }
        }
        if (videos.length) grouped.set(server, videos);
      }
      if (!grouped.size) throw Error("Shiro did not return a supported stream.");
      return [...grouped].map(([server, videos]) => result(server, [...new Map(videos.map((v) => [v.url, v])).values()]));
    }
  };
}
export {
  activate
};
