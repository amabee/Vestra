// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {createHtmlManga} from "../../../lib/html-manga.js";
import {elements,hasClass,links,images} from "../../../lib/manga-common.js";
export function activate({host}) {return createHtmlManga(host,{
 origin:"https://ravenscans.org",hosts:["ravenscans.org","i0.wp.com","i1.wp.com","i2.wp.com"],language:"en",
 bookPattern:/^\/(?:manga|series)\/[a-z0-9_-]+\/?$/i,chapterPattern:/^\/(?=[a-z0-9_.-]*chapter)[a-z0-9_.-]+\/?$/i,
 searchPath:(q,page)=>`${page===1?"/":`/page/${page}/`}?s=${encodeURIComponent(q)}`,
 results:html=>elements(html,"div",a=>hasClass(a,"bsx")).map(block=>block.body),
 chapterLinks:html=>elements(html,"li",a=>a["data-num"]!==undefined).flatMap(block=>links(block.body).map(link=>({...link,text:`Chapter ${block.attributes["data-num"]} ${link.text}`}))),
 belongs:(chapter,book)=>chapter.startsWith("/"+book.split("/")[2]+"-"),
 readerImages:html=>elements(html,"div",a=>a.id==="readerarea").flatMap(block=>elements(block.body,"noscript").flatMap(part=>images(part.body))),
 imageReferer:()=>"https://ravenscans.org/",
});}
