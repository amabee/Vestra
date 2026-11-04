// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {reader,pageOptions,asset,chapters,pages,text} from "../../../lib/manga-common.js";
const ORIGIN="https://atsu.moe",CDN="https://cdn.atsu.moe",HOSTS=["atsu.moe","cdn.atsu.moe"];
function identity(id){if(typeof id!=="string"||!/^[a-z0-9_-]{1,100}$/i.test(id))throw Error("Invalid Atsumaru identity.");return id;}
function image(raw){return typeof raw==="string"&&raw.startsWith("/")?CDN+raw:raw;}
export function activate({host}) {
  const read=reader(host,ORIGIN);
  async function searchPage(query,options={}) {
    const {page,limit}=pageOptions(options),q=String(query).trim().slice(0,500);if(!q)return{items:[],hasMore:false};
    const data=await read(`/collections/manga/documents/search?q=${encodeURIComponent(q)}&query_by=title%2CenglishTitle%2CotherNames&page=${page}&per_page=${limit}`,true);
    if(!Array.isArray(data?.hits)||!Number.isInteger(data.found)||data.found<0||data.page!==page)throw Error("Atsumaru returned invalid search pagination.");
    const seen=new Set();const items=data.hits.flatMap(hit=>{const d=hit.document;if(!d||typeof d.id!=="string"||!/^[a-z0-9_-]{1,100}$/i.test(d.id)||typeof d.title!=="string"||!d.title.trim()||seen.has(d.id))return[];seen.add(d.id);return[{id:d.id,title:text(d.title).slice(0,500),cover:asset(image(d.posterMedium||d.poster),ORIGIN,HOSTS,ORIGIN+"/")}];});
    return{items,hasMore:page*limit<data.found};
  }
  return{searchPage,async search(query,options={}){return(await searchPage(query,{...options,page:1})).items;},
    async getChapters(id){identity(id);const data=await read(`/api/manga/allChapters?mangaId=${encodeURIComponent(id)}`,true);if(!Array.isArray(data?.chapters))throw Error("Atsumaru returned invalid chapters.");return chapters(data.chapters.map(row=>{identity(row.id);const n=String(row.number);return{id:`${id}|${row.id}`,title:`Chapter ${n}${row.title?` — ${text(row.title)}`:""}`};}),"en");},
    async getPages(id){if(typeof id!=="string")throw Error("Invalid Atsumaru chapter identity.");const parts=id.split("|");if(parts.length!==2)throw Error("Invalid Atsumaru chapter identity.");const [book,chapter]=parts.map(identity);const data=await read(`/api/read/chapter?mangaId=${encodeURIComponent(book)}&chapterId=${encodeURIComponent(chapter)}`,true);const entries=data?.readChapter?.pages;if(!Array.isArray(entries)||entries.some(row=>!Number.isFinite(row.number)))throw Error("Atsumaru returned invalid pages.");return pages([...entries].sort((a,b)=>a.number-b.number).map(row=>image(row.image)),ORIGIN,HOSTS,`${ORIGIN}/read/${book}/${chapter}`);},
  };
}
