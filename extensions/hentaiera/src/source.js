import { createMangaSite } from "../../../lib/manga-sites.js";
export function activate({ host }) {
  return createMangaSite(host, {
    kind: "era",
    origin: "https://hentaiera.com",
    hosts: ["hentaiera.com", "m4.hentaiera.com", "m11.hentaiera.com"],
  });
}
