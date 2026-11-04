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

// lib/anime-common.js
function identity(value, pattern = /^[a-z0-9_-]+$/i) {
  if (typeof value !== "string" || !value.length || value.length > 500 || !pattern.test(value)) throw Error("Invalid anime source identity.");
  return value;
}
function sourcePath(value, origin, pattern) {
  const p = url(value, origin);
  if (!p || p.value !== origin + p.path || p.path.length > 500 || !pattern.test(p.path)) throw Error("Invalid anime source path.");
  return p.path;
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

// extensions/animegg/src/source.js
var ORIGIN = "https://www.animegg.org";
function activate({ host }) {
  const read = request(host, ORIGIN);
  return {
    async search(query, options = {}) {
      const q = String(query).trim().slice(0, 500);
      if (!q) return [];
      const html = await read("/search/?q=" + encodeURIComponent(q)), rows = [];
      for (const a of links(html)) {
        if (!hasClass(a, "mse")) continue;
        const path = sourcePath(a.href, ORIGIN, /^\/series\/[a-z0-9_-]+\/?$/i), title = text(elements(a.body, "h2")[0]?.body ?? a.title);
        if (title) rows.push({ id: path.replace(/^\/series\//, "").replace(/\/$/, ""), title, url: ORIGIN + path });
      }
      return titles(rows, options.limit);
    },
    async getEpisodes(value) {
      const book = identity(value), html = await read("/series/" + book), rows = [];
      for (const a of links(html)) {
        if (!hasClass(a, "anm_det_pop")) continue;
        const path = sourcePath(a.href, ORIGIN, /^\/[a-z0-9_-]+-episode-\d+(?:\.\d+)?(?:-[a-z0-9_-]+)?\/?$/i), n = /-episode-(\d+(?:\.\d+)?)/i.exec(path);
        if (n) rows.push({ id: path, number: Number(n[1]), title: text(elements(a.body, "i", (a2) => hasClass(a2, "anititle"))[0]?.body) || `Episode ${n[1]}`, url: ORIGIN + path });
      }
      return episodes(rows, book);
    },
    async getStreams(value, options = {}) {
      const path = sourcePath(value, ORIGIN, /^\/[a-z0-9_-]+-episode-\d+(?:\.\d+)?(?:-[a-z0-9_-]+)?\/?$/i), html = await read(path), results = [], failures = [];
      for (const [id, server] of [["subbed-Animegg", "GG-SUB"], ["dubbed-Animegg", "GG-DUB"]]) {
        if (options.excludeServers?.includes(server)) continue;
        const tab = elements(html, "div", (a) => a.id === id)[0];
        if (!tab) continue;
        try {
          const frame = /<iframe\b([^>]*)>/i.exec(tab.body), embed = sourcePath(attrs(frame?.[1]).src, ORIGIN, /^\/[^\s#]{1,480}$/), body = await read(embed), array = /\b(?:var|let|const)\s+videoSources\s*=\s*(\[[\s\S]*?\])/.exec(body)?.[1];
          if (!array) throw Error("AnimeGG player source data is missing.");
          const videos = [];
          for (const m of array.matchAll(/\{([^{}]*)\}/g)) {
            const file = /\bfile\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(m[1]), label = /\blabel\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(m[1]);
            if (file) videos.push(rendition(literal(file[1]), ORIGIN, { quality: label ? literal(label[1]) : "auto", type: "mp4", headers: { Referer: ORIGIN + "/" } }));
          }
          results.push(result(server, videos, { Referer: ORIGIN + "/" }));
        } catch (error) {
          failures.push(String(error.message ?? error));
        }
      }
      if (!results.length) throw Error(failures[0] ?? "AnimeGG has no available sub/dub server for this episode.");
      return results;
    }
  };
}
export {
  activate
};
