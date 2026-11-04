// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
// Native SDK adaptation Copyright (c) 2026 Vestra contributors.
import {reader,pageOptions,links,images,asset,chapters,pages,sourceId,url,elements,hasClass,text} from "../../../lib/manga-common.js";
const ORIGIN="https://mangahub.ru",HOSTS=["mangahub.ru","p1.statichub.org","ty2.statichub.org","fd1.statichub.org"];
const BOOK=/^\/title\/[a-z0-9_-]+$/i,CHAPTER=/^\/read\/\d+$/;
export function activate({host}) {
  const read=reader(host,ORIGIN);
  async function searchPage(query,options={}) {
    const {page}=pageOptions(options),q=String(query).trim().slice(0,500);
    if(!q)return {items:[],hasMore:false};
    const html=await read(`/search?query=${encodeURIComponent(q)}${page>1?`&page=${page}`:""}`),found=new Map();
    for(const block of elements(html,"div",a=>hasClass(a,"item-slide"))) {
      const link=links(block.body).find(link=>hasClass(link,"fw-medium"));if(!link)continue;
      const parsed=url(link.href,ORIGIN),img=images(block.body).find(img=>hasClass(img,"item-slide-image"));
      if(parsed?.host!=="mangahub.ru"||!BOOK.test(parsed.path)||!link.text)continue;
      found.set(parsed.path,{id:parsed.path,title:text(link.text).slice(0,500),cover:asset(img?.["data-src"]||img?.src,ORIGIN,HOSTS,ORIGIN+"/")});
    }
    if(found.size>400)throw Error("MangaHub returned too many search results.");
    const items=[...found.values()],hasMore=items.length>0&&links(html).some(link=>link.rel==="next"||new RegExp(`[?&]page=${page+1}(?:&|$)`).test(link.href??""));
    return {items,hasMore};
  }
  return {
    searchPage,
    async search(query,options={}){return (await searchPage(query,{...options,page:1})).items;},
    async getChapters(id) {
      const path=sourceId(id,ORIGIN,BOOK),html=await read(path+"/chapters"),rows=[];
      for(const link of links(html)) {
        const parsed=url(link.href,ORIGIN);
        if(parsed?.host==="mangahub.ru"&&CHAPTER.test(parsed.path)&&hasClass(link,"fs-2")&&hasClass(link,"fw-medium"))rows.push({id:parsed.path,title:link.text});
      }
      return chapters(rows,"ru");
    },
    async getPages(id) {
      const path=sourceId(id,ORIGIN,CHAPTER),html=await read(path);
      const urls=elements(html,"reader-scan").flatMap(block=>images(block.body).map(img=>img["data-src"]||img.src).filter(Boolean));
      return pages(urls,ORIGIN,HOSTS,ORIGIN+path);
    },
  };
}
