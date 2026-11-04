// Adapted from Seanime-contributions/Seanime-Providers, MIT, Copyright (c) 2025 Pal.
// Native Vestra API, pagination and strict URL validation: Copyright (c) 2026 Vestra contributors.
import { reader, pageOptions, asset, pages, chapters, sourceId, text } from "../../../lib/manga-common.js";
const ORIGIN="https://mangak.io", API="https://api.mangak.io";
const IMAGES=["rx.resmk.org",..."abcdefghik".split("").map(letter=>`rx.qvzr${letter}.org`)];
export function activate({host}) {
  const api=reader(host,API),html=reader(host,ORIGIN);
  async function searchPage(query, options={}) {
    const {page,limit}=pageOptions(options), q=String(query).trim().slice(0,500);
    if(!q)return {items:[],hasMore:false};
    const result=await api(`/titles/search?page=${page}&limit=${limit}&q=${encodeURIComponent(q)}`,true);
    const data=result?.data;
    if(result?.success!==true||!Array.isArray(data?.items)||typeof data.pagination?.has_next!=="boolean"||data.pagination.page!==page)throw Error("MangaK returned invalid search pagination.");
    const seen=new Set();
    const items=data.items.filter(row=>typeof row.id==="string"&&/^[a-zA-Z0-9_-]{1,100}$/.test(row.id)&&typeof row.name==="string"&&row.name.trim()&&!seen.has(row.id)&&seen.add(row.id)).map(row=>({id:row.id,title:text(row.name).slice(0,500),cover:asset(row.cover,ORIGIN,IMAGES,ORIGIN+"/")}));
    return {items,hasMore:data.pagination.has_next};
  }
  return {
    searchPage,
    async search(query,options={}) { return (await searchPage(query,{...options,page:1})).items; },
    async getChapters(id) {
      if(typeof id!=="string"||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error("Invalid MangaK title identity.");
      const result=await api(`/titles/${id}/chapters`,true);
      if(result?.success!==true||!Array.isArray(result.data?.chapters))throw Error("MangaK returned an invalid chapter list.");
      return chapters(result.data.chapters.map(row=>({id:sourceId(row.url,ORIGIN,/^\/[a-z0-9_-]+\/[a-z0-9_.-]+$/i),title:row.name})),"en");
    },
    async getPages(id) {
      const path=sourceId(id,ORIGIN,/^\/[a-z0-9_-]+\/[a-z0-9_.-]+$/i),body=await html(path);
      const match=/<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/i.exec(body);
      if(!match)throw Error("MangaK reader metadata is missing.");
      let data;try{data=JSON.parse(match[1]);}catch{throw Error("MangaK reader metadata is invalid.");}
      return pages(data?.props?.pageProps?.initialChapter?.images,ORIGIN,IMAGES,ORIGIN+"/");
    },
  };
}
