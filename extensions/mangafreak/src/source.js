// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {createHtmlManga} from "../../../lib/html-manga.js";
import {elements,hasClass,links,images} from "../../../lib/manga-common.js";
export function activate({host}) {return createHtmlManga(host,{
 origin:"https://ww3.mangafreak.me",hosts:["ww3.mangafreak.me","images.mangafreak.me","images2.mangafreak.me"],language:"en",
 bookPattern:/^\/Manga\/[a-z0-9_-]+$/i,chapterPattern:/^\/Read\d+_[a-z0-9_.-]+$/i,
 searchPath:(q,page)=>`/Find/${encodeURIComponent(q)}${page>1?`/${page}`:""}`,
 results:html=>elements(html,"div",a=>hasClass(a,"manga_search_item")).map(block=>block.body),
 chapterLinks:html=>elements(html,"div",a=>hasClass(a,"manga_series_list")||hasClass(a,"series_sub_chapter_list")).flatMap(block=>links(block.body).map(link=>({...link,text:`Chapter ${link.href?.match(/_(\d+(?:\.\d+)?)$/)?.[1]??"Special"} ${link.text}`}))),
 belongs:(chapter,book)=>chapter.toLowerCase().includes("_"+book.split("/")[2].toLowerCase()+"_"),
 readerImages:html=>elements(html,"div",a=>hasClass(a,"mySlides")&&hasClass(a,"fade")).flatMap(block=>images(block.body)),
});}
