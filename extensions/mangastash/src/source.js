// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {createHtmlManga} from "../../../lib/html-manga.js";
import {elements,hasClass,links,images} from "../../../lib/manga-common.js";
export function activate({host}) {return createHtmlManga(host,{
 origin:"https://mangastash.org",hosts:["mangastash.org"],language:"en",
 bookPattern:/^\/[a-z0-9_-]+(?:\/[a-z0-9_-]+)?\/?$/i,chapterPattern:/^\/[a-z0-9/_-]+\/chapter-\d+(?:[.-]\d+)?\/?$/i,
 searchPath:(q,page)=>`/search?q=${encodeURIComponent(q)}${page>1?`&page=${page}`:""}`,
 results:html=>html.match(/<a\b(?=[^>]*\bclass=["'][^"']*\bsearch-result-row\b[^"']*["'])[^>]*>[\s\S]*?<\/a>/gi)||[],
 chapterLinks:html=>links(html).filter(link=>hasClass(link,"chapter-row")).map(link=>({...link,text:`Chapter ${link["data-num"]??link.href?.match(/chapter-([\d.]+)/)?.[1]??"Special"} ${link.text}`})),
 belongs:(chapter,book)=>chapter.startsWith(book.replace(/\/$/,"")+"/"),
 readerImages:html=>elements(html,"div",a=>hasClass(a,"reader-page")).sort((a,b)=>Number(a.attributes["data-page"]??a.offset)-Number(b.attributes["data-page"]??b.offset)).flatMap(block=>images(block.body).slice(0,1)),
});}
