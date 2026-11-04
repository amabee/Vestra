// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {
  reader,
  pageOptions,
  links,
  images,
  url,
  asset,
  text,
  chapters,
  pages,
} from "../../../lib/manga-common.js";
import { flightData, jsonArray } from "../../../lib/rsc-data.js";
const ORIGIN = "https://xcomic.me";
const HOSTS = [
  "xcomic.me",
  "cdn.mangabaka.dev",
  "i00.img00.org",
  "i00.img01.org",
  "i00.img02.org",
  "i01.img00.org",
  "i01.img01.org",
  "i02.img02.org",
  "i03.img01.org",
  "i04.img01.org",
  "i05.img01.org",
  "i06.img00.org",
  "i06.img02.org",
  "i07.img00.org",
  "i07.img01.org",
  "i07.img02.org",
  "i08.img00.org",
  "i08.img01.org",
  "i09.img00.org",
  "i09.img01.org",
];
function identity(value) {
  if (typeof value !== "string" || !/^[a-z0-9_-]{1,200}$/i.test(value))
    throw Error("Invalid xComic identity.");
  return value;
}
export function activate({ host }) {
  const read = reader(host, ORIGIN),
    cache = new Map();
  async function readPage(q, page) {
    const key = q + "|" + page,
      hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await fetchPage(q, page);
    if (cache.size >= 8) cache.delete(cache.keys().next().value);
    cache.set(key, { value, until: Date.now() + 20000 });
    return value;
  }
  async function searchPage(query, options = {}) {
    const { page } = pageOptions(options),
      q = String(query).trim().slice(0, 500);
    if (!q) return { items: [], hasMore: false };
    const current = await readPage(q, page);
    if (current.hasMore || !current.items.length || page === 1000)
      return current;
    const next = await readPage(q, page + 1),
      ids = new Set(current.items.map((i) => i.id));
    return {
      items: current.items,
      hasMore: next.items.some((i) => !ids.has(i.id)),
    };
  }
  async function fetchPage(q, page) {
    const html = await read(
        `/search?word=${encodeURIComponent(q)}&sortby=score&page=${page}`,
      ),
      found = new Map();
    for (const a of links(html)) {
      const p = url(a.href, ORIGIN),
        match = /^\/title\/([a-z0-9_-]+)$/.exec(p?.path ?? "");
      if (p?.host !== "xcomic.me" || !match || images(a.body).length) continue;
      const title = text(a.body);
      if (!title) continue;
      const preceding = html.slice(Math.max(0, a.offset - 1600), a.offset),
        img = images(preceding).pop();
      found.set(match[1], {
        id: match[1],
        title: title.slice(0, 500),
        cover: asset(img?.src, ORIGIN, HOSTS, ORIGIN + "/"),
      });
    }
    if (found.size > 400) throw Error("xComic returned too many results.");
    const hasMore = links(html).some((a) => {
      const p = url(a.href, ORIGIN);
      return (
        p?.host === "xcomic.me" &&
        p.path.startsWith("/search?") &&
        new RegExp("(?:[?&])page=" + String(page + 1) + "(?:&|$)").test(p.path)
      );
    });
    return { items: [...found.values()], hasMore };
  }
  return {
    searchPage,
    async search(q, o = {}) {
      return (await searchPage(q, { ...o, page: 1 })).items;
    },
    async getChapters(value) {
      const book = identity(value),
        html = await read("/title/" + book),
        sources = [],
        sourceLinks = links(html).filter((a) => /^\/source\//.test(a.href));
      for (const [i, a] of sourceLinks.entries()) {
        const p = url(a.href, ORIGIN),
          m = /^\/source\/([a-z0-9_-]+)$/.exec(p?.path ?? "");
        if (p?.host !== "xcomic.me" || !m) continue;
        const next = sourceLinks[i + 1]?.offset ?? -1,
          card = html.slice(a.offset, next < 0 ? html.length : next),
          label = text(a.body),
          before = html.slice(Math.max(0, a.offset - 180), a.offset),
          language =
            label +
            " " +
            ([...before.matchAll(/[\u{1F1E6}-\u{1F1FF}]{2}/gu)].pop()?.[0] ??
              "");
        if (!/🇬🇧|🇺🇸|🇨🇦|🇦🇺|🇳🇿|🇮🇪|\bEnglish\b/u.test(language)) continue;
        const count = Number(
          (text(card).match(/([\d,]+)\s+chapters?/i)?.[1] ?? "0").replace(
            /,/g,
            "",
          ),
        );
        sources.push({ id: m[1], count });
      }
      if (!sources.length) return [];
      sources.sort((a, b) => b.count - a.count);
      const source = sources[0],
        body = await read("/source/" + source.id),
        rows = [];
      for (const a of links(body)) {
        const p = url(a.href, ORIGIN),
          m = /^\/chapter\/([a-z0-9_-]+)$/.exec(p?.path ?? "");
        if (p?.host === "xcomic.me" && m)
          rows.push({ id: m[1], title: text(a.body) });
      }
      return chapters(rows, "en");
    },
    async getPages(value) {
      const chapter = identity(value),
        path = "/chapter/" + chapter,
        html = await read(path);
      let raw;
      const flight = flightData(html);
      if (flight.includes('"imageUrls"')) raw = jsonArray(flight, "imageUrls");
      else {
        const qwik =
          /<script\b[^>]*type=["']qwik\/(?:state|json)["'][^>]*>([\s\S]*?)<\/script>/i.exec(
            html,
          )?.[1];
        if (!qwik) throw Error("xComic reader data is missing.");
        const data = qwik.replace(/"imageUrls",\d+,\[/, '"imageUrls":[');
        raw = jsonArray(data, "imageUrls");
        if (raw.some((v) => v !== 0 && typeof v !== "string"))
          throw Error("Invalid xComic serialized images.");
        raw = raw.filter((v) => typeof v === "string");
      }
      return pages(raw, ORIGIN, HOSTS, ORIGIN + path);
    },
  };
}
