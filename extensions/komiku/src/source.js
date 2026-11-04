// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {createHtmlManga} from "../../../lib/html-manga.js";
import {elements,hasClass,links,images,text} from "../../../lib/manga-common.js";
export function activate({host}) {return createHtmlManga(host,{
 origin:"https://komiku.org",searchOrigin:"https://api.komiku.org",hosts:["komiku.org","api.komiku.org","img.komiku.org"],language:"id",
 bookPattern:/^\/manga\/[a-z0-9_-]+\/?$/i,chapterPattern:/^\/[a-z0-9_.-]+-chapter-[a-z0-9_.-]+\/?$/i,
 searchPath:(q,page)=>`${page===1?"/":`/page/${page}/`}?post_type=manga&s=${encodeURIComponent(q)}`,
 results:html=>elements(html,"div",a=>hasClass(a,"bge")).map(block=>block.body),
 title:block=>text(elements(block,"h3")[0]?.body),
 chapterLinks:html=>elements(html,"td",a=>hasClass(a,"judulseries")).flatMap(block=>links(block.body)),
 belongs:(chapter,book)=>chapter.startsWith("/"+book.split("/")[2]+"-chapter-"),
 readerImages:html=>images(html).filter(img=>hasClass(img,"klazy")&&hasClass(img,"ww")),
});}
