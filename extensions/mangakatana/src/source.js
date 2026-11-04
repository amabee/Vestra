// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
// Native SDK adaptation Copyright (c) 2026 Vestra contributors.
import {reader,pageOptions,links,images,asset,chapters,pages,sourceId,url,meta,text,elements} from "../../../lib/manga-common.js";
const ORIGIN="https://mangakatana.com",HOSTS=["mangakatana.com","i1.mangakatana.com"];
const BOOK=/^\/manga\/[a-z0-9_.-]+$/i,CHAPTER=/^\/manga\/[a-z0-9_.-]+\/c\d+(?:\.\d+)?$/i;
export function activate({host}) {
  const read=reader(host,ORIGIN);
  async function searchPage(query,options={}) {
    const {page}=pageOptions(options),q=String(query).trim().slice(0,500);
    if(!q)return {items:[],hasMore:false};
    const html=await read(`${page===1?"/":`/page/${page}/`}?search=${encodeURIComponent(q)}&search_by=m_name`);
    const found=new Map();
    const listing=elements(html,"div",a=>a.id==="book_list")[0]?.body??"";
    for(const link of links(listing)) {
      const parsed=url(link.href,ORIGIN);if(!parsed||parsed.host!=="mangakatana.com"||!BOOK.test(parsed.path))continue;
      const img=images(link.body)[0],id=parsed.path,old=found.get(id);
      const title=text(link.title||link.text||img?.alt||old?.title);
      const cover=asset(img?.["data-src"]||img?.src,ORIGIN,HOSTS,ORIGIN+"/");
      if(title&&title!=="[Cover]")found.set(id,{id,title:title.slice(0,500),cover:cover||old?.cover||null});
      else if(cover)found.set(id,{id,title:old?.title??"",cover});
    }
    if(!found.size&&page===1) {
      const canonical=meta(html,"og:url"),parsed=url(canonical,ORIGIN),title=meta(html,"og:title");
      if(parsed?.host==="mangakatana.com"&&BOOK.test(parsed.path)&&title)found.set(parsed.path,{id:parsed.path,title:text(title).slice(0,500),cover:asset(meta(html,"og:image"),ORIGIN,HOSTS,ORIGIN+"/")});
    }
    const items=[...found.values()].filter(row=>row.title).slice(0,400);
    const hasMore=items.length>0&&links(html).some(link=>link.rel==="next"||new RegExp(`/page/${page+1}/(?:\\?|$)`).test(link.href??""));
    return {items,hasMore};
  }
  return {
    searchPage,
    async search(query,options={}){return (await searchPage(query,{...options,page:1})).items;},
    async getChapters(id) {
      const path=sourceId(id,ORIGIN,BOOK),html=await read(path),rows=[];
      for(const link of links(html)) {
        const parsed=url(link.href,ORIGIN);
        if(parsed?.host==="mangakatana.com"&&parsed.path.startsWith(path+"/c")&&CHAPTER.test(parsed.path))rows.push({id:parsed.path,title:link.text});
      }
      return chapters(rows,"en");
    },
    async getPages(id) {
      const path=sourceId(id,ORIGIN,CHAPTER),html=await read(path),match=/\bvar\s+thzq\s*=\s*(\[[\s\S]*?\]);/i.exec(html);
      if(!match)throw Error("MangaKatana reader metadata is missing.");
      const urls=[];let remaining=match[1].slice(1,-1);
      while(remaining.trim()) {
        const entry=/^\s*(["'])((?:\\.|(?!\1)[^\\])*)\1\s*(?:,|$)/.exec(remaining);
        if(!entry)throw Error("MangaKatana returned invalid page metadata.");
        urls.push(entry[2].replace(/\\\//g,"/"));remaining=remaining.slice(entry[0].length);
      }
      return pages(urls,ORIGIN,HOSTS,ORIGIN+"/");
    },
  };
}
