// lib/manga-sites.js
var entities = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};
function text(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, key) => {
    if (key[0] !== "#") return entities[key.toLowerCase()] || _;
    const n = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return n > 0 && n <= 1114111 ? String.fromCodePoint(n) : "";
  }).replace(/\s+/g, " ").trim();
}
function attrs(tag) {
  const values = {};
  for (const m of tag.matchAll(
    /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  ))
    values[m[1].toLowerCase()] = text(m[2] ?? m[3] ?? m[4]);
  return values;
}
function href(raw, origin) {
  let s = String(raw || "").trim().replace(/&amp;/g, "&");
  const root = /^https:\/\/[^/?#]+/.exec(origin)?.[0] || origin;
  if (s.startsWith("//")) s = "https:" + s;
  else if (s.startsWith("/")) s = root + s;
  else if (s.startsWith("?")) s = origin.split("?")[0].replace(/\/?$/, "/") + s;
  s = s.replace(/^(https:\/\/[^/?#]+)(?=\?)/, "$1/");
  return /^https:\/\/[^@:/?#\s]+(?:\/[^\s#]*)?$/i.test(s) ? s : "";
}
function hostOf(url) {
  return /^https:\/\/([^/?#]+)/.exec(url)?.[1].toLowerCase() || "";
}
function anchors(html) {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({
    attributes: attrs(m[1]),
    body: m[2]
  }));
}
function images(html) {
  return [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => attrs(m[0]));
}
function meta(html, key) {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (a.property === key || a.name === key) return a.content || "";
  }
  return "";
}
function createMangaSite(host, config) {
  const { origin, kind, hosts } = config, allowed = new Set(hosts), cache = /* @__PURE__ */ new Map();
  const isBook = (url) => url.startsWith(origin + "/") && (kind === "era" ? /^\/gallery\/\d+\/$/.test(url.slice(origin.length)) : /^\/[a-z0-9][a-z0-9_-]*\/$/i.test(url.slice(origin.length)) && !/^\/(?:hentai-|search|login|register|category|tag|artist|language|page)/i.test(
    url.slice(origin.length)
  ));
  const bookUrl = (id) => {
    const url = href(id, origin).replace(/[?].*$/, "").replace(/\/?$/, "/");
    if (!isBook(url)) throw Error("Invalid manga ID for this source.");
    return url;
  };
  function asset(raw, referer) {
    const url = href(raw, origin);
    return url && allowed.has(hostOf(url)) ? { url, headers: { Referer: referer } } : null;
  }
  async function read(url) {
    if (!url.startsWith(origin + "/"))
      throw Error("Source URL is outside its origin.");
    const known = cache.get(url);
    if (known && known.until > Date.now()) return known.html;
    const response = await host.fetch({
      url,
      method: "GET",
      headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0" }
    });
    if (response.status !== 200)
      throw Error(`Source returned HTTP ${response.status}.`);
    if (typeof response.body !== "string" || response.body.length > 2097152)
      throw Error("Source HTML exceeds its size limit.");
    if (/cf-chl-|just a moment|verify you are human/i.test(response.body))
      throw Error("The source requires browser verification.");
    if (cache.size >= 12) cache.delete(cache.keys().next().value);
    cache.set(url, { html: response.body, until: Date.now() + 6e4 });
    return response.body;
  }
  function listing(html) {
    const books = /* @__PURE__ */ new Map();
    for (const entry of anchors(html)) {
      const id = href(entry.attributes.href, origin).replace(/[?].*$/, "").replace(/\/?$/, "/");
      if (!isBook(id)) continue;
      const img = images(entry.body)[0], cover = img && asset(
        img["data-src"] || img["data-original"] || img.src,
        origin + "/"
      );
      const title = text(entry.attributes.title || entry.body) || img && text(img.alt);
      if (!title && !cover) continue;
      const old = books.get(id);
      books.set(id, {
        id,
        title: title || old?.title || "",
        cover: cover || old?.cover || null
      });
    }
    return [...books.values()].filter((row) => row.title).map((row) => ({ ...row, title: row.title.slice(0, 500) }));
  }
  async function searchPage(query, { page = 1 } = {}) {
    if (!Number.isInteger(page) || page < 1 || page > 1e3)
      throw Error("Invalid search page.");
    if (String(query).startsWith("https://")) {
      const id = bookUrl(query);
      if (page !== 1) return { items: [], hasMore: false };
      const html2 = await read(id);
      const title = text(
        meta(html2, "og:title") || html2.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      );
      if (!title) throw Error("The source did not return manga metadata.");
      return {
        items: [
          {
            id,
            title: title.slice(0, 500),
            cover: asset(meta(html2, "og:image"), id)
          }
        ],
        hasMore: false
      };
    }
    const q = encodeURIComponent(String(query).trim());
    const url = kind === "era" ? `${origin}/search/?key=${q}&page=${page}` : `${origin}/hentai-search/?search=${q}&page=${page}`;
    const html = await read(url), items = listing(html), next = page + 1;
    const hasMore = items.length > 0 && anchors(html).some((a) => {
      const link = href(a.attributes.href, url);
      return link.startsWith(origin + "/") && (new RegExp("(?:[?&]page=|/page/)" + next + "(?:[&/]|$)").test(
        link
      ) || a.attributes.rel === "next");
    });
    return { items, hasMore };
  }
  return {
    searchPage,
    async search(query, options = {}) {
      return (await searchPage(query, { page: 1, ...options })).items;
    },
    async getChapters(id) {
      const url = bookUrl(id), html = await read(url);
      if (kind === "era") {
        if (!anchors(html).some(
          (a) => /\/view\/\d+\/1\//.test(a.attributes.href || "")
        ))
          throw Error("The gallery reader is unavailable.");
        return [{ id: url, number: "1", title: "Gallery", index: 0 }];
      }
      const chapters = /* @__PURE__ */ new Map();
      for (const entry of anchors(html)) {
        const target = href(entry.attributes.href, origin);
        const n = target.startsWith(url) ? /^([0-9]+(?:\.[0-9]+)?)\/?$/.exec(target.slice(url.length))?.[1] : null;
        if (n)
          chapters.set(target, {
            id: target,
            number: n,
            title: text(entry.body) || `Chapter ${n}`,
            index: 0
          });
      }
      return [...chapters.values()].sort((a, b) => Number(a.number) - Number(b.number)).map((row, index) => ({ ...row, index }));
    },
    async getPages(id) {
      if (kind === "era") {
        const url2 = bookUrl(id), html2 = await read(url2), view = anchors(html2).map((a) => href(a.attributes.href, origin)).find(
          (link) => link.startsWith(origin + "/view/") && /\/1\/$/.test(link)
        );
        if (!view) throw Error("The gallery reader is unavailable.");
        const reader = await read(view), full = images(reader).map((img) => href(img["data-src"] || img.src, origin)).find(
          (url3) => allowed.has(hostOf(url3)) && /\/1\.(webp|jpg|jpeg|png)(?:\?|$)/i.test(url3)
        );
        const raw2 = reader.match(
          /\bg_th\s*=\s*\$\.parseJSON\(\s*'([^']+)'\s*\)/
        )?.[1];
        if (!raw2 || !full)
          throw Error(
            "Gallery page metadata is missing or uses an unsupported image host."
          );
        const table = JSON.parse(raw2);
        const base = full.slice(0, full.lastIndexOf("/") + 1), extensions = { w: "webp", j: "jpg", p: "png", g: "gif" };
        return Object.keys(table).filter((n) => /^\d+$/.test(n) && Number(n) > 0).sort((a, b) => Number(a) - Number(b)).map((n, index) => {
          const extension = extensions[String(table[n]).split(",")[0]];
          if (!extension) throw Error("Unknown gallery image format.");
          return { ...asset(base + n + "." + extension, url2), index };
        });
      }
      const url = href(id, origin);
      if (!url.startsWith(origin + "/") || !/^\/[a-z0-9_-]+\/\d+(?:\.\d+)?\/$/i.test(url.slice(origin.length)))
        throw Error("Invalid chapter ID.");
      const html = await read(url);
      const raw = html.match(/["']images["']\s*:\s*(\[[^\]]*\])/i)?.[1];
      if (!raw) throw Error("Reader image metadata is missing.");
      const values = JSON.parse(raw);
      if (!Array.isArray(values)) throw Error("Invalid reader images.");
      return values.map((value, index) => {
        const path = String(value);
        const rawUrl = /^(?:https:)?\/\//.test(path) ? path : "https://hentaicdn.com" + (path.startsWith("/hentai/") ? path : "/hentai/" + path.replace(/^\//, ""));
        const image = asset(rawUrl, url);
        if (!image)
          throw Error("Reader image host was not granted to this source.");
        return { ...image, index };
      });
    }
  };
}

// extensions/hentai2read/src/source.js
function activate({ host }) {
  return createMangaSite(host, {
    kind: "h2r",
    origin: "https://hentai2read.com",
    hosts: ["hentai2read.com", "hentaicdn.com"]
  });
}
export {
  activate
};
