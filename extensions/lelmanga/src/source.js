// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {createHtmlManga} from "../../../lib/html-manga.js";
import {elements,hasClass,links,images} from "../../../lib/manga-common.js";
export function activate({host}) {return createHtmlManga(host,{
 origin:"https://www.lelmanga.com",hosts:["www.lelmanga.com","lelmanga.com","i0.wp.com","i1.wp.com","i2.wp.com"],language:"fr",
 bookPattern:/^\/manga\/[a-z0-9_-]+\/?$/i,chapterPattern:/^\/[a-z0-9_.-]+-\d+(?:[.-]\d+)?\/?$/i,
 searchPath:(q,page)=>`${page===1?"/":`/page/${page}/`}?s=${encodeURIComponent(q)}`,
 results:html=>elements(html,"div",a=>hasClass(a,"bsx")).map(block=>block.body),
 chapterLinks:html=>elements(html,"li",a=>a["data-num"]!==undefined).flatMap(block=>links(block.body).map(link=>({...link,text:`Chapitre ${block.attributes["data-num"]} ${link.text}`}))),
 belongs:(chapter,book)=>chapter.startsWith("/"+book.split("/")[2]+"-"),
 readerImages:html=>elements(html,"div",a=>a.id==="readerarea").flatMap(block=>images(block.body)).filter(img=>!/(?:resize|w)=(?:130|165)(?:&|$)/.test(img["data-src"]||img.src||"")),
 imageReferer:()=>"https://www.lelmanga.com/",
});}
