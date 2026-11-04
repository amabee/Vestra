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

// lib/rsc-data.js
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

// lib/anime-embed.js
function frames(html) {
  return [...html.matchAll(/<iframe\b([^>]*)>/gi)].map((m) => attrs(m[1]).src).filter(Boolean);
}
async function extractPlayer(start, read, { origin, hosts, server, headers = {}, typeHint } = {}) {
  let current = start;
  const visited = /* @__PURE__ */ new Set();
  for (let depth = 0; depth < 4; depth++) {
    const target = url(current, origin);
    if (!target || !hosts.includes(target.host) || visited.has(target.value)) throw Error("Unapproved or repeated anime player URL.");
    visited.add(target.value);
    const raw = (await read(target.value)).replace(/<!--[\s\S]*?-->/g, ""), html = raw + "\n" + unpackData(raw), videos = [];
    if (target.host === "www.blogger.com") {
      const decoded = html.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      for (const m of decoded.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
        let value;
        try {
          value = literal(m[0]);
        } catch {
          continue;
        }
        if (!value.includes('"formats":')) continue;
        let formats;
        try {
          formats = jsonArray(value, "formats");
        } catch {
          continue;
        }
        for (const format of formats) {
          if (typeof format.url !== "string" || !/^video\/mp4(?:;|$)/i.test(format.mimeType ?? "")) continue;
          const p = url(format.url, origin);
          if (!p?.host.endsWith(".googlevideo.com") || !p.path.startsWith("/videoplayback?")) continue;
          videos.push(rendition(format.url, origin, { type: "mp4", quality: format.qualityLabel ?? format.quality ?? "auto", headers: { Referer: target.value } }));
        }
      }
    }
    const literals = [...html.matchAll(/(?:\b(?:file|src)|["'](?:file|src)["'])\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g), ...html.matchAll(/\b(?:var|let|const)\s+primary\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)];
    for (const match of literals) {
      const raw2 = literal(match[1]);
      let type;
      try {
        const inner = /[?&]src=([^&]+)/.exec(raw2);
        if (inner && /\.m3u8(?:[?#]|$)/i.test(decodeURIComponent(inner[1]))) type = "hls";
      } catch {
      }
      try {
        videos.push(rendition(raw2, origin, { headers: { Referer: target.value, ...headers }, type: type ?? typeHint }));
      } catch {
      }
    }
    for (const match of html.matchAll(/<source\b([^>]*)>/gi)) {
      const a = attrs(match[1]);
      if (a.src) try {
        videos.push(rendition(a.src, origin, { headers: { Referer: target.value, ...headers } }));
      } catch {
      }
    }
    if (videos.length) return result(server, [...new Map(videos.map((v) => [v.url, v])).values()], { Referer: target.value, ...headers });
    const next = frames(html).find((raw2) => hosts.includes(url(raw2, origin)?.host));
    if (!next) throw Error("Anime player did not expose supported media data.");
    current = next;
  }
  throw Error("Anime player exceeded its nesting limit.");
}

// extensions/anitube/src/source.js
var ORIGIN = "https://www.anitube.zip";
var PATH = /^\/(?:[a-z0-9_-]+\/){0,3}[a-z0-9_-]+\/?$/i;
function activate({ host }) {
  const read = request(host, ORIGIN);
  return {
    async search(query, options = {}) {
      const q = String(query).trim().slice(0, 500);
      if (!q) return [];
      const html = await read("/?s=" + encodeURIComponent(q)), rows = [];
      for (const card of elements(html, "div", (a) => hasClass(a, "aniItem"))) {
        const a = links(card.body)[0];
        if (!a) continue;
        const path = sourcePath(a.href, ORIGIN, PATH);
        rows.push({ id: path, title: a.title || a.text, url: ORIGIN + path });
      }
      return titles(rows, options.limit);
    },
    async getEpisodes(value) {
      const book = sourcePath(value, ORIGIN, PATH), html = await read(book), rows = [];
      for (const block of elements(html, "div", (a) => hasClass(a, "pagAniListaContainer"))) for (const a of links(block.body)) {
        const number = /Epis[oó]dio\s*(\d+(?:\.\d+)?)/i.exec(a.text);
        if (!number) continue;
        const path = sourcePath(a.href, ORIGIN, PATH);
        rows.push({ id: path, number: Number(number[1]), title: a.text, url: ORIGIN + path });
      }
      return episodes(rows, book);
    },
    async getStreams(value, options = {}) {
      const path = sourcePath(value, ORIGIN, PATH), html = await read(path), results = [], errors = [];
      for (const [id, server] of [["blog2", "Blog 2"], ["blog1", "Blog 1"]]) {
        if (options.excludeServers?.includes(server)) continue;
        const frame = frames(elements(html, "div", (a) => a.id === id)[0]?.body ?? "")[0];
        if (!frame) continue;
        try {
          results.push(await extractPlayer(frame, read, { origin: ORIGIN, hosts: ["www.anitube.zip", "api.anivideo.net", "www.blogger.com"], server }));
        } catch (error) {
          errors.push(String(error.message ?? error));
        }
      }
      if (!results.length) throw Error(errors[0] ?? "AniTube has no supported player for this episode.");
      return results;
    }
  };
}
export {
  activate
};
