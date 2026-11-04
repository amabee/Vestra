import { createMangaSite } from "../../../lib/manga-sites.js";
export function activate({ host }) {
  return createMangaSite(host, {
    kind: "h2r",
    origin: "https://hentai2read.com",
    hosts: ["hentai2read.com", "hentaicdn.com"],
  });
}
