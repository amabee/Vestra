// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {createHtmlManga} from "../../../lib/html-manga.js";
import {elements,hasClass,links,images,text} from "../../../lib/manga-common.js";
export function activate({host}) {
  return createHtmlManga(host,{
    origin:"https://m.fanfox.net",hosts:["m.fanfox.net","fmcdn.mfcdn.net","zjcdn.mangafox.me"],language:"en",
    bookPattern:/^\/manga\/[a-z0-9_-]+\/?$/i,chapterPattern:/^\/manga\/[a-z0-9_-]+\/v\d+\/c\d+(?:\.\d+)?\/1\.html$/i,
    searchPath:(q,page)=>`/search?k=${encodeURIComponent(q)}${page>1?`&page=${page}`:""}`,
    results:html=>elements(html,"div",a=>hasClass(a,"post-one")).map(block=>block.body),
    title:block=>text(elements(block,"p",a=>hasClass(a,"title"))[0]?.body),
    chapterLinks:html=>elements(html,"dd",a=>hasClass(a,"chlist")).flatMap(block=>links(block.body)),
    belongs:(chapter,book)=>chapter.startsWith(book.replace(/\/$/,"")+"/"),
    readerImages:async(html,path,read)=>{
      const initial=images(html).filter(img=>hasClass(img,"reader-page"));
      if(initial.length)return initial;
      const continuous=await read(path.replace("/manga/","/roll_manga/"));
      return images(continuous).filter(img=>hasClass(img,"reader-page")||String(img["data-original"]||img.src).includes("/store/manga/"));
    },
  });
}
