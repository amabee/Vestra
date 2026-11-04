// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {reader,pageOptions,attrs,links,url,sourceId,asset,chapters,pages,text} from "../../../lib/manga-common.js";
const ORIGIN="https://asurascans.com",HOSTS=["asurascans.com","cdn.asurascans.com"];
const BOOK=/^\/comics\/[a-z0-9_-]+$/i,CHAPTER=/^\/comics\/[a-z0-9_-]+\/chapter\/\d+(?:\.\d+)?$/i;
function props(html,name) {
  for(const match of html.matchAll(/<astro-island\b([^>]*)>/gi)) {
    const a=attrs(match[1]);if(!(a["component-url"]??a.opts??"").includes(name)&&!(a.opts??"").includes(name))continue;
    try{return JSON.parse(a.props);}catch{throw Error("AsuraScans returned invalid reader data.");}
  }
  throw Error(`AsuraScans ${name} metadata is missing.`);
}
function value(encoded){return Array.isArray(encoded)&&encoded[0]===0?encoded[1]:encoded;}
function array(encoded){if(!Array.isArray(encoded)||encoded[0]!==1||!Array.isArray(encoded[1]))throw Error("AsuraScans returned invalid list data.");return encoded[1].map(value);}
export function activate({host}) {
  const read=reader(host,ORIGIN);
  async function searchPage(query,options={}) {
    const {page}=pageOptions(options),q=String(query).trim().slice(0,500);if(!q)return{items:[],hasMore:false};
    const html=await read(`/browse?search=${encodeURIComponent(q)}${page>1?`&page=${page}`:""}`),data=props(html,"BrowseFilters"),seen=new Set();
    const items=array(data.initialSeries).flatMap(row=>{
      const id=value(row.public_url)||`/comics/${value(row.slug)}`,parsed=url(id,ORIGIN),title=value(row.title);
      if(parsed?.host!=="asurascans.com"||!BOOK.test(parsed.path)||typeof title!=="string"||!title.trim()||seen.has(parsed.path))return[];seen.add(parsed.path);
      return[{id:parsed.path,title:text(title).slice(0,500),cover:asset(value(row.cover),ORIGIN,HOSTS,ORIGIN+"/")}];
    });
    if(items.length>400)throw Error("AsuraScans returned too many search results.");
    const totalPages=value(data.initialTotalPages),currentPage=value(data.initialCurrentPage);
    if(totalPages!==undefined&&(!Number.isInteger(totalPages)||totalPages<0||totalPages>1000))throw Error("AsuraScans returned invalid pagination.");
    if(currentPage!==undefined&&currentPage!==page)throw Error("AsuraScans returned the wrong search page.");
    const hasMore=Number.isInteger(totalPages)?page<totalPages:links(html).some(link=>link.rel==="next"||new RegExp(`[?&]page=${page+1}(?:&|$)`).test(link.href??""));
    return{items,hasMore};
  }
  return{searchPage,async search(query,options={}){return(await searchPage(query,{...options,page:1})).items;},
    async getChapters(id){const path=sourceId(id,ORIGIN,BOOK),html=await read(path);return chapters(links(html).flatMap(link=>{const p=url(link.href,ORIGIN);return p?.host==="asurascans.com"&&p.path.startsWith(path+"/chapter/")&&CHAPTER.test(p.path)?[{id:p.path,title:link.text||`Chapter ${p.path.split("/").pop()}`}]:[];}),"en");},
    async getPages(id){const path=sourceId(id,ORIGIN,CHAPTER),html=await read(path),data=props(html,"ChapterReader");return pages(array(data.pages).map(row=>value(row.url)),ORIGIN,HOSTS,ORIGIN+path);},
  };
}
