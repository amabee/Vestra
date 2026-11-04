// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
// Original provider credited by upstream to kRYstall9.
import {createHtmlManga} from "../../../lib/html-manga.js";
import {elements,hasClass,links,images} from "../../../lib/manga-common.js";
export function activate({host}) {return createHtmlManga(host,{
 origin:"https://www.mangaworldadult.net",hosts:["www.mangaworldadult.net","cdn.mangaworld.mx"],language:"it",
 bookPattern:/^\/manga\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)?\/?$/i,chapterPattern:/^\/manga\/[a-z0-9/_-]+\/read\/[a-z0-9_.-]+\/?$/i,
 searchPath:(q,page)=>`/archive?keyword=${encodeURIComponent(q.toLowerCase())}${page>1?`&page=${page}`:""}`,
 results:html=>elements(html,"div",a=>hasClass(a,"entry")).map(block=>block.body),
 chapterLinks:html=>links(elements(html,"div",a=>hasClass(a,"chapters-wrapper"))[0]?.body??html).filter(link=>hasClass(link,"chap")||link.href?.includes('/read/')).map(link=>({...link,href:link.href?.split('?')[0],text:`Chapter ${link.text.match(/(?:capitolo|chapter|cap\.?)\s*(\d+(?:[.-]\d+)?)/i)?.[1]??"Special"} ${link.text}`})),
 belongs:(chapter,book)=>chapter.startsWith(book.replace(/\/$/,"")+"/"),
 readerPath:path=>path+"?style=list",
 readerImages:html=>elements(html,"div",a=>a.id==="page").flatMap(block=>images(block.body)),
 imageReferer:path=>"https://www.mangaworldadult.net"+path.split('/read/')[0],
});}
