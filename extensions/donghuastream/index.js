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

// lib/anime-html.js
function htmlAnime(config, { host }) {
  const origin = config.origin, fetch = request(host, origin), read = (path, options = {}) => fetch(path, { ...options, headers: { ...config.headers ?? {}, ...options.headers } });
  return {
    async search(query, options = {}) {
      const q = String(query).trim().slice(0, 500);
      if (!q) return [];
      const html = await read(config.searchPath(q)), rows = [];
      for (const block of config.cards(html)) {
        const a = links(block.body).find((a2) => {
          try {
            sourcePath(a2.href, origin, config.bookPattern);
            return true;
          } catch {
            return false;
          }
        });
        if (!a) continue;
        const path = sourcePath(a.href, origin, config.bookPattern), img = images(a.body)[0], title = text(a.title || elements(a.body, "div", (a2) => hasClass(a2, "tt"))[0]?.body || img?.alt || a.text);
        if (!title) continue;
        let cover;
        try {
          if (img?.src) cover = mediaUrl(img.src, origin);
        } catch {
        }
        rows.push({ id: path, title: config.title ? config.title(title, block) : title, url: origin + path, ...cover ? { cover } : {} });
      }
      return titles(rows, options.limit);
    },
    async getEpisodes(value) {
      const book = sourcePath(value, origin, config.bookPattern), html = await read(book), rows = [];
      for (const a of config.episodeLinks(html)) {
        let path;
        try {
          path = sourcePath(a.href, origin, config.episodePattern);
        } catch {
          continue;
        }
        const number = config.number(a), title = config.episodeTitle?.(a) ?? (text(elements(a.body, "div", (a2) => hasClass(a2, "epl-title"))[0]?.body) || `Episode ${number}`);
        if (!Number.isFinite(number)) continue;
        rows.push({ id: path, number, title, url: origin + path });
      }
      return episodes(rows, book);
    },
    async getStreams(value, options = {}) {
      return config.streams(sourcePath(value, origin, config.episodePattern), read, options);
    }
  };
}

// lib/anime-embed.js
function frames(html) {
  return [...html.matchAll(/<iframe\b([^>]*)>/gi)].map((m) => attrs(m[1]).src).filter(Boolean);
}

// lib/base64.js
function decodeBase64Bytes(value) {
  if (typeof value !== "string" || value.length > 65536) throw Error("Encoded source data exceeds its limit.");
  const input = value.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input) || input.length % 4 === 1) throw Error("Invalid encoded source data.");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", bytes = [];
  let bits = 0, n = 0;
  for (const c of input) {
    if (c === "=") break;
    n = n << 6 | alphabet.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(n >> bits & 255);
    }
  }
  return Uint8Array.from(bytes);
}
function decodeBase64(value) {
  const bytes = decodeBase64Bytes(value);
  try {
    return decodeURIComponent([...bytes].map((b) => "%" + b.toString(16).padStart(2, "0")).join(""));
  } catch {
    throw Error("Invalid UTF-8 source data.");
  }
}

// lib/json-data.js
function jsonAfter(text2, pattern) {
  const match = pattern.exec(text2);
  if (!match) throw Error("Source JSON data is missing.");
  const start = match.index + match[0].length;
  let at = start;
  while (/\s/.test(text2[at] ?? "")) at++;
  const open = text2[at], close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) throw Error("Source JSON value is invalid.");
  const stack = [], begin = at;
  let quoted = false, escape = false;
  for (; at < text2.length; at++) {
    const c = text2[at];
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") {
      const was = stack.pop();
      if (was !== (c === "}" ? "{" : "[")) break;
      if (!stack.length) {
        try {
          return JSON.parse(text2.slice(begin, at + 1));
        } catch {
          break;
        }
      }
    }
    if (stack.length > 64) break;
  }
  throw Error("Source JSON data is invalid.");
}

// extensions/donghuastream/src/source.js
var ORIGIN = "https://donghuastream.org";
function activate(context) {
  return htmlAnime({ origin: ORIGIN, headers: { "User-Agent": "Mozilla/5.0" }, searchPath: (q) => "/?s=" + encodeURIComponent(q), bookPattern: /^\/anime\/[a-z0-9_-]+\/?$/i, episodePattern: /^\/(?!anime\/)[a-z0-9_-]+\/?$/i, cards: (html) => elements(html, "article", (a) => hasClass(a, "bs")), episodeLinks: (html) => elements(html, "div", (a) => hasClass(a, "eplister")).flatMap((b) => links(b.body)), number: (a) => Number.parseFloat(text(elements(a.body, "div", (a2) => hasClass(a2, "epl-num"))[0]?.body)), async streams(path, read, options) {
    const html = await read(path), results = [], failures = [];
    const servers = [...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((m) => ({ ...attrs(m[1]), label: text(m[2]) })).filter((a) => a.value && a["data-index"] !== void 0);
    if (servers.length > 20) throw Error("DonghuaStream returned too many servers.");
    for (const [index, option] of servers.entries()) {
      const server = option.label || "Server " + (index + 1);
      if (options.excludeServers?.includes(server)) continue;
      try {
        const decoded = decodeBase64(option.value), frame = frames(decoded)[0], p = url(frame, ORIGIN);
        if (!p) throw Error("DonghuaStream player is missing.");
        let videos = [], headers;
        if (["geo.dailymotion.com", "www.dailymotion.com"].includes(p.host)) {
          const id = /\/video\/([a-z0-9]+)/i.exec(p.path)?.[1] ?? /[?&]video=([a-z0-9]+)/i.exec(p.path)?.[1];
          if (!id) throw Error("Invalid Dailymotion video identity.");
          identity(id);
          const data = await read("https://www.dailymotion.com/player/metadata/video/" + id, { json: true });
          if (data.error) throw Error("Dailymotion did not authorize playback.");
          headers = { Referer: "https://geo.dailymotion.com/" };
          for (const [quality, items] of Object.entries(data.qualities ?? {})) for (const item of items) {
            const type = /mpegurl/i.test(item.type ?? "") ? "hls" : /^video\/mp4/i.test(item.type ?? "") ? "mp4" : null;
            if (type) videos.push(rendition(item.url, ORIGIN, { type, quality, headers }));
          }
        } else if (p.host === "rumble.com") {
          const player = await read(p.value);
          let data;
          try {
            data = jsonAfter(player, /m\.f\[["'][^"']+["']\]\s*=\s*/);
          } catch {
            data = jsonAfter(player, /\b(?:var|let|const)\s+video\s*=\s*/);
          }
          headers = { Referer: "https://rumble.com/" };
          const walk = (value, depth = 0) => {
            if (depth > 15) return;
            if (value && typeof value === "object") {
              if (typeof value.url === "string") try {
                videos.push(rendition(value.url, ORIGIN, { quality: value.height ? value.height + "p" : "auto", headers }));
              } catch {
              }
              for (const child of Object.values(value)) walk(child, depth + 1);
            }
          };
          walk(data);
        } else throw Error("DonghuaStream returned an unsupported player host.");
        results.push(result(server, [...new Map(videos.map((v) => [v.url, v])).values()], headers));
      } catch (error) {
        failures.push(String(error.message ?? error));
      }
    }
    if (!results.length) throw Error(failures[0] ?? "DonghuaStream has no supported stream for this episode.");
    return results;
  } }, context);
}
export {
  activate
};
