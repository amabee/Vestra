// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
// Updated for the source's current Blogger catalogue and episode layout.
import {request,sourcePath,titles,episodes,elements,hasClass,text,rendition,result,url} from '../../../lib/anime-common.js';
import {extractPlayer} from '../../../lib/anime-embed.js';
const ORIGIN='https://www.nontonanimeid.my.id',BOOK=/^\/\d{4}\/\d{2}\/[a-z0-9_-]+\.html$/i;
const PLAYERS=['www.nontonanimeid.my.id','www.blogger.com','gogoanime-gdplayer.blogspot.com','urlmp41.blogspot.com'];
function rows(html){return elements(html,'div',a=>hasClass(a,'DagPlayOpt')&&a['data-embed']).map(block=>{const label=text(elements(block.body,'span')[0]?.body);return{url:block.attributes['data-embed'],server:block.attributes['data-id']||'NontonAnime',number:/^movie$/i.test(label)?0:/^\d+(?:\.\d+)?$/.test(label)?Number(label):NaN};}).filter(row=>Number.isFinite(row.number));}
export function activate({host}){const read=request(host,ORIGIN);return{
 async search(query,options={}){const q=String(query).trim().slice(0,500);if(!q)return[];const data=await read('/feeds/posts/default?alt=json&q='+encodeURIComponent(q)+'&max-results=50',{json:true}),entries=data.feed?.entry??[];if(!Array.isArray(entries))throw Error('Invalid NontonAnime catalogue.');const found=[];for(const item of entries){const href=item.link?.find(link=>link.rel==='alternate')?.href;if(!href)continue;let path;try{path=sourcePath(href,ORIGIN,BOOK);}catch{continue;}found.push({id:path,title:item.title?.$t,url:ORIGIN+path});}return titles(found,options.limit);},
 async getEpisodes(value){const book=sourcePath(value,ORIGIN,BOOK),data=rows(await read(book));return episodes(data.map(row=>({id:book+'|'+row.number,number:row.number,url:ORIGIN+book})),book);},
 async getStreams(value,options={}){const parts=String(value).split('|');if(parts.length!==2||!/^\d+(?:\.\d+)?$/.test(parts[1]))throw Error('Invalid NontonAnime episode identity.');const book=sourcePath(parts[0],ORIGIN,BOOK),number=Number(parts[1]),found=new Map(),errors=[];for(const row of rows(await read(book))){if(row.number!==number||options.excludeServers?.includes(row.server))continue;const headers={Referer:ORIGIN+book};let videos;
  try{const p=url(row.url,ORIGIN),type=p?.host.endsWith('.cdn.rumble.cloud')&&/\.tar(?:[?#]|$)/i.test(p.path)?'hls':undefined;videos=[rendition(row.url,ORIGIN,{headers,type})];}catch{try{const p=url(row.url,ORIGIN);if(!PLAYERS.includes(p?.host))throw Error('NontonAnime returned an unsupported external player.');videos=(await extractPlayer(p.value,read,{origin:ORIGIN,hosts:PLAYERS,server:row.server,headers})).videoSources;}catch(error){errors.push(String(error.message??error));continue;}}
  const list=found.get(row.server)??[];list.push(...videos);found.set(row.server,list);
 }if(!found.size)throw Error(errors[0]??'NontonAnime has no supported player for this episode.');return[...found].map(([server,video])=>result(server,[...new Map(video.map(v=>[v.url,v])).values()]));},
};}
