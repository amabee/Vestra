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
function literal(value) {
  if (typeof value !== "string" || value.length > 65536 || !/^(["'])[\s\S]*\1$/.test(value)) throw Error("Invalid source string literal.");
  if (value[0] === '"') {
    try {
      return JSON.parse(value);
    } catch {
      throw Error("Invalid source string literal.");
    }
  }
  let out = "";
  for (let i = 1; i < value.length - 1; i++) {
    let c = value[i];
    if (c === "\\") {
      c = value[++i];
      const special = { n: "\n", r: "\r", t: "	", b: "\b", f: "\f", v: "\v" };
      if (c === "u" || c === "x") {
        const size = c === "u" ? 4 : 2, hex = value.slice(i + 1, i + 1 + size);
        if (!new RegExp("^[0-9a-f]{" + size + "}$", "i").test(hex)) throw Error("Invalid escaped source string.");
        out += String.fromCharCode(parseInt(hex, 16));
        i += size;
        continue;
      }
      out += special[c] ?? c;
    } else out += c;
  }
  return out;
}

// lib/packed-data.js
function unpackData(html) {
  const quoted = `("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`;
  const re = new RegExp(
    "\\}\\s*\\(\\s*" + quoted + "\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*" + quoted + `\\.split\\(["']\\|["']\\)`,
    "g"
  );
  const results = [];
  for (const m of html.matchAll(re)) {
    const radix = Number(m[2]), count = Number(m[3]);
    if (radix < 2 || radix > 62 || count > 1e4)
      throw Error("Packed source data exceeds its limit.");
    const payload = literal(m[1]), table = literal(m[4]).split("|"), alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let size = 0;
    const decoded = payload.replace(/\b[0-9a-zA-Z]+\b/g, (word) => {
      let n = 0;
      for (const c of word) {
        const digit = alphabet.indexOf(c);
        if (digit < 0 || digit >= radix) return word;
        n = n * radix + digit;
        if (n >= count) return word;
      }
      const value = table[n] || word;
      size += value.length;
      if (size > 1024 * 1024)
        throw Error("Unpacked source data exceeds its limit.");
      return value;
    });
    results.push(decoded);
    if (results.length > 10) throw Error("Too many packed source blocks.");
  }
  return results.join("\n");
}

// extensions/animetvplus/src/source.js
var ORIGIN = "https://animetvplus.xyz";
var SEARCH = "https://search.animetvplus.site";
var EMBED = "https://embed.animetvplus.site";
var PLAYERS = ["uqload.net", "uqload.to", "uqload.io"];
function absolute(value, base, bundle = false) {
  if (typeof value !== "string" || !value.trim()) throw Error("Invalid AniTVPlus resource URL.");
  const v = value.trim(), p = url(base, ORIGIN);
  if (/^https:\/\/|^\/\//i.test(v)) return mediaUrl(v, base);
  if (!p) throw Error("Invalid AniTVPlus resource base.");
  const root = "https://" + p.host, dir = p.path.split(/[?#]/)[0].replace(/[^/]*$/, "");
  return mediaUrl(root + (bundle ? dir + v.replace(/^\/+/, "") : v.startsWith("/") ? v : dir + v), root);
}
function astro(value, depth = 0, state = { left: 1e5 }) {
  if (depth > 64 || --state.left < 0) throw Error("AniTVPlus page data exceeds its limit.");
  if (Array.isArray(value)) {
    if (value.length === 2 && Number.isInteger(value[0])) return value[0] === 1 && Array.isArray(value[1]) ? value[1].map((v) => astro(v, depth + 1, state)) : astro(value[1], depth + 1, state);
    return value.map((v) => astro(v, depth + 1, state));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) if (!["__proto__", "prototype", "constructor"].includes(k)) out[k] = astro(value[k], depth + 1, state);
    return out;
  }
  return value;
}
function tracks(rows, base, bundle = false) {
  const out = [];
  for (const [i, t] of (rows ?? []).entries()) {
    if (!t?.file || /upload captions/i.test(t.label ?? "") || /\/empty\.srt$/i.test(t.file)) continue;
    try {
      out.push({ id: "track-" + i, url: absolute(t.file, base, bundle), language: String(t.lang || { english: "en", spanish: "es", italian: "it", french: "fr", german: "de", portuguese: "pt", arabic: "ar", indonesian: "id" }[String(t.label).toLowerCase()] || "und"), label: text(t.label || t.lang || "Subtitle"), isDefault: Boolean(t.default) });
    } catch {
    }
  }
  return out;
}
function activate({ host }) {
  const read = request(host, ORIGIN);
  return {
    async search(query, options = {}) {
      const q = String(query).trim().slice(0, 500);
      if (!q) return [];
      const data = await read(SEARCH + "/v1/search?q=" + encodeURIComponent(q) + "&offset=0&limit=50", { json: true });
      if (!Array.isArray(data.data)) throw Error("Invalid AniTVPlus catalogue.");
      return titles(data.data.filter((m) => /^\d+$/.test(String(m?.mal_id)) && m.title).map((m) => ({ id: String(m.mal_id), title: m.title, url: ORIGIN + "/anime/" + m.mal_id })), options.limit);
    },
    async getEpisodes(value) {
      const id = identity(value, /^[1-9]\d{0,8}$/), html = await read("/anime/" + id);
      let card;
      for (const m of html.matchAll(/<astro-island\b([^>]*)>/gi)) {
        const raw = attrs(m[1]).props;
        if (!raw) continue;
        let props;
        try {
          props = astro(JSON.parse(raw));
        } catch {
          continue;
        }
        card = props?.initialCrCard || props?.initial_cr_card;
        if (card) break;
      }
      if (!card) throw Error("AniTVPlus episode data is unavailable.");
      const season = [...card.seasons ?? [], card.selected_season].find((s) => s && String(s.owner_mal ?? s.mal_id) === id && Array.isArray(s.episodes));
      if (!season) throw Error("AniTVPlus did not return the selected season.");
      return episodes(season.episodes.filter((e) => e && e.has_stream !== false && e.stream_ep != null && Number.isFinite(Number(e.ep)) && /^\d+$/.test(String(e.stream_ep))).map((e) => ({ id: id + ":" + e.stream_ep, number: Number(e.ep), title: e.title ? "Episode " + e.ep + ": " + e.title : "Episode " + e.ep, url: ORIGIN + "/anime/" + id })), id);
    },
    async getStreams(value, options = {}) {
      if (options.excludeServers?.includes("AniTVPlus")) return [];
      const id = identity(value, /^[1-9]\d{0,8}:\d{1,5}$/), [mal, ep] = id.split(":"), api = EMBED + "/hls3/uq/" + mal + "?episode=" + ep;
      let data;
      try {
        data = await read(api, { json: true, headers: { Origin: EMBED, Referer: EMBED + "/" } });
      } catch {
      }
      let raw, subtitles = [], headers = { Referer: EMBED + "/", Origin: EMBED };
      if (data?.m3u8) raw = absolute(data.m3u8, api);
      else {
        const resolved = await read(EMBED + "/home/api/v1/resolve?mal=" + mal + "&ep=" + ep, { json: true }), p = url(resolved?.uqload?.embed_url, EMBED);
        if (!resolved?.ok || !PLAYERS.includes(p?.host)) throw Error("AniTVPlus did not return a supported UQLoad player.");
        const html = await read(p.value, { headers: { Referer: EMBED + "/" } }), unpacked = unpackData(html), m = /["'](https:\/\/[^"'\s<>]+\.m3u8(?:\?[^"'\s<>]*)?)["']/.exec(unpacked);
        if (!m) throw Error("AniTVPlus player did not expose an HLS playlist.");
        raw = mediaUrl(m[1], p.value);
        headers = { Referer: p.value, Origin: "https://" + p.host };
        const objects = /\btracks\s*:\s*\[([\s\S]*?)\]/.exec(unpacked)?.[1] ?? "", rows = [];
        for (const block of objects.match(/\{[^{}]*\}/g) ?? []) {
          const row = {};
          for (const k of ["file", "label", "kind"]) {
            const m2 = new RegExp(`(?:["']?` + k + `["']?)\\s*:\\s*("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`).exec(block);
            if (m2) row[k] = literal(m2[1]);
          }
          if (/^(captions|subtitles)$/i.test(row.kind ?? "")) rows.push({ ...row, default: /\bdefault\s*:\s*true/.test(block) });
        }
        subtitles = tracks(rows, p.value);
      }
      if (data?.meta) {
        try {
          const meta2 = absolute(data.meta, api), response = await read(meta2, { full: true, headers }), parsed = JSON.parse(response.body);
          subtitles = tracks(Array.isArray(parsed.subs) ? parsed.subs : [], response.url || meta2, true);
        } catch {
        }
      }
      return [result("AniTVPlus", [rendition(raw, EMBED, { type: "hls", headers, subtitles })])];
    }
  };
}
export {
  activate
};
