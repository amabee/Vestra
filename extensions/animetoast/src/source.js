// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {request,sourcePath,titles,episodes,links,elements,hasClass,text,url} from '../../../lib/anime-common.js';
import {frames,extractPlayer} from '../../../lib/anime-embed.js';
const ORIGIN='https://www.animetoast.cc',BOOK=/^\/[a-z0-9_-]+\/?$/i;
function tabs(html){const ids=links(html).filter(a=>/^#multi_link_tab\d+$/.test(a.href)&&/mp4upload/i.test(a.text)).map(a=>a.href.slice(1));const all=elements(html,'div',a=>/^multi_link_tab\d+$/.test(a.id??''));return ids.length?all.filter(a=>ids.includes(a.attributes.id)):all.slice(0,1);}
function inventory(html,book){const found=new Map();for(const tab of tabs(html))for(const a of links(tab.body)){const match=/[?&]link=(\d+)(?:&|$)/.exec(a.href),number=/\bEp\.?\s*(\d+(?:\.\d+)?)/i.exec(a.text);if(!match||!number)continue;const key=book+'?link='+match[1];found.set(key,{id:key,number:Number(number[1]),title:'Episode '+number[1],url:ORIGIN+key});}return[...found.values()];}
export function activate({host}){const read=request(host,ORIGIN);return{
 async search(query,options={}){const q=String(query).trim().slice(0,500);if(!q)return[];const html=await read('/?s='+encodeURIComponent(q)),rows=[];for(const block of elements(html,'div',a=>/^post-\d+$/.test(a.id??''))){const h=elements(block.body,'h3')[0],a=links(h?.body??'')[0];if(!a)continue;let path;try{path=sourcePath(a.href,ORIGIN,BOOK);}catch{continue;}rows.push({id:path,title:a.text,url:ORIGIN+path});}return titles(rows,options.limit);},
 async getEpisodes(value){const book=sourcePath(value,ORIGIN,BOOK);return episodes(inventory(await read(book),book),book);},
 async getStreams(value,options={}){const path=sourcePath(value,ORIGIN,/^\/[a-z0-9_-]+\/?\?link=\d+$/i);if(options.excludeServers?.includes('MP4Upload'))throw Error('No untried AnimeToast server remains.');const html=await read(path),frame=frames(html).find(f=>url(f,ORIGIN)?.host==='www.mp4upload.com');if(!frame)throw Error('AnimeToast MP4Upload player is missing.');return[await extractPlayer(frame,read,{origin:ORIGIN,hosts:['www.mp4upload.com'],server:'MP4Upload',headers:{Referer:'https://www.mp4upload.com/'}})];},
};}
