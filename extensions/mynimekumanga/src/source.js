// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {reader,pageOptions,elements,hasClass,links,images,asset,chapters,pages,sourceId,url,text,attrs} from "../../../lib/manga-common.js";
const ORIGIN="https://www.mynimeku.com",HOSTS=["www.mynimeku.com","image.mydriveku.my.id"],BOOK=/^\/komik\/[a-z0-9_-]+\/?$/i,CHAPTER=/^\/(?:chapter\/)?[a-z0-9_.-]+-chapter-[a-z0-9_.-]+\/?$/i;
export function activate({host}) {
 const read=reader(host,ORIGIN);let nonce=null;
 async function searchPage(query,options={}) {
  const {page}=pageOptions(options),q=String(query).trim().slice(0,500);if(!q)return{items:[],hasMore:false};
  if(!nonce){const html=await read("/");for(const match of html.matchAll(/<form\b([^>]*)>/gi)){const form=attrs(match[1]);if(form.id==="search-form"&&form["data-ajax-url"]===ORIGIN+"/wp-admin/admin-ajax.php")nonce=form["data-nonce"];}nonce??=/mynimeku[\s\S]{0,1200}?["']nonce["']\s*:\s*["']([a-z0-9]+)["']/i.exec(html)?.[1];if(!nonce||!/^[a-z0-9]{1,100}$/i.test(nonce))throw Error("MyNimeKu search configuration is missing. Check for an extension update.");}
  const response=await host.fetch({url:ORIGIN+"/wp-admin/admin-ajax.php",method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded; charset=UTF-8",Referer:ORIGIN+"/",Origin:ORIGIN},body:`action=mynimeku_live_search&nonce=${encodeURIComponent(nonce)}&keyword=${encodeURIComponent(q)}&page=${page}`});
  if(response.status!==200)throw Error(`MyNimeKu search returned HTTP ${response.status}.`);let data;try{data=JSON.parse(response.body);}catch{throw Error("MyNimeKu returned invalid search data.");}if(data.success===false||!Array.isArray(data.data?.items))throw Error("MyNimeKu search could not complete.");
  const found=new Map();for(const row of data.data.items){const p=url(row.url,ORIGIN);if(row.type!=="MANGA"||p?.host!=="www.mynimeku.com"||!BOOK.test(p.path)||typeof row.title!=="string"||!row.title.trim())continue;found.set(p.path,{id:p.path,title:text(row.title).slice(0,500),cover:asset(row.cover,ORIGIN,HOSTS,ORIGIN+"/")});}
  return{items:[...found.values()],hasMore:data.data.has_more===true};
 }
 return{searchPage,async search(q,o={}){return(await searchPage(q,{...o,page:1})).items;},
  async getChapters(id){const path=sourceId(id,ORIGIN,BOOK),html=await read(path),rows=elements(html,"div",a=>a["data-chapter-number"]!==undefined).flatMap(block=>links(block.body).filter(link=>hasClass(link,"komik-series-chapter-item")).map(link=>({id:sourceId(link.href,ORIGIN,CHAPTER),title:`Chapter ${block.attributes["data-chapter-number"]} ${link.text}`})));return chapters(rows,"id");},
  async getPages(id){const path=sourceId(id,ORIGIN,CHAPTER),html=await read(path),raw=elements(html,"div",a=>hasClass(a,"komik-reader-content")).flatMap(block=>images(block.body).map(img=>img["data-lazy-src"]||img["data-src"]||img.src)).filter(Boolean);return pages(raw,ORIGIN,HOSTS,ORIGIN+"/");},
 };
}
