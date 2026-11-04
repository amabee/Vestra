// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {reader,pageOptions,links,images,asset,chapters,pages,sourceId,url,text} from "../../../lib/manga-common.js";
const ORIGIN="https://kuramanga.com",HOSTS=["kuramanga.com","shadowabyss.com"],BOOK=/^\/[a-z0-9_-]+$/i,CHAPTER=/^\/[a-z0-9_-]+\/chapter-[a-z0-9_.-]+$/i;
export function activate({host}) {
 const read=reader(host,ORIGIN),cache=new Map();
 async function result(q,page){const key=q+"|"+page,known=cache.get(key);if(known&&known.until>Date.now())return known.data;const data=await read(`/search?ajax=1&page=${page}&name=${encodeURIComponent(q)}`,true);if(!Array.isArray(data?.data))throw Error("KuraManga returned invalid search data.");if(cache.size>=16)cache.delete(cache.keys().next().value);cache.set(key,{data,until:Date.now()+20000});return data;}
 async function searchPage(query,options={}) {
  const {page}=pageOptions(options),q=String(query).trim().slice(0,500);if(!q)return{items:[],hasMore:false};const data=await result(q,page),seen=new Set();
  const items=data.data.flatMap(row=>{const id="/"+row.normalized_title;if(!BOOK.test(id)||typeof row.title!=="string"||!row.title.trim()||seen.has(id))return[];seen.add(id);return[{id,title:text(row.title).slice(0,500),cover:asset(row.thumb,ORIGIN,HOSTS,ORIGIN+"/")}];});
  if(items.length>400)throw Error("KuraManga returned too many search results.");
  let hasMore=false;if(items.length&&page<1000){try{hasMore=(await result(q,page+1)).data.length>0;}catch{hasMore=true;}}
  return{items,hasMore};
 }
 return{searchPage,async search(query,options={}){return(await searchPage(query,{...options,page:1})).items;},
  async getChapters(id){const path=sourceId(id,ORIGIN,BOOK),html=await read(path);return chapters(links(html).flatMap(link=>{const p=url(link.href,ORIGIN);return p?.host==="kuramanga.com"&&p.path.startsWith(path+"/chapter-")&&CHAPTER.test(p.path)?[{id:p.path,title:link.text}]:[];}),"en");},
  async getPages(id){const path=sourceId(id,ORIGIN,CHAPTER),html=await read(path);return pages(images(html).map(img=>img["data-src"]||img.src).filter(raw=>typeof raw==="string"&&raw.includes("/chapters/")),ORIGIN,HOSTS,ORIGIN+path);},
 };
}
