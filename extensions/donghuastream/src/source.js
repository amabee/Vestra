// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {request,identity,elements,hasClass,links,text,url,rendition,result,attrs} from '../../../lib/anime-common.js';
import {htmlAnime} from '../../../lib/anime-html.js';import{frames}from'../../../lib/anime-embed.js';import{decodeBase64}from'../../../lib/base64.js';import{jsonAfter}from'../../../lib/json-data.js';
const ORIGIN='https://donghuastream.org';
export function activate(context){return htmlAnime({origin:ORIGIN,headers:{'User-Agent':'Mozilla/5.0'},searchPath:q=>'/?s='+encodeURIComponent(q),bookPattern:/^\/anime\/[a-z0-9_-]+\/?$/i,episodePattern:/^\/(?!anime\/)[a-z0-9_-]+\/?$/i,cards:html=>elements(html,'article',a=>hasClass(a,'bs')),episodeLinks:html=>elements(html,'div',a=>hasClass(a,'eplister')).flatMap(b=>links(b.body)),number:a=>Number.parseFloat(text(elements(a.body,'div',a=>hasClass(a,'epl-num'))[0]?.body)),async streams(path,read,options){
 const html=await read(path),results=[],failures=[];const servers=[...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(m=>({...attrs(m[1]),label:text(m[2])})).filter(a=>a.value&&a['data-index']!==undefined);if(servers.length>20)throw Error('DonghuaStream returned too many servers.');
 for(const [index,option]of servers.entries()){const server=option.label||'Server '+(index+1);if(options.excludeServers?.includes(server))continue;try{const decoded=decodeBase64(option.value),frame=frames(decoded)[0],p=url(frame,ORIGIN);if(!p)throw Error('DonghuaStream player is missing.');let videos=[],headers;
  if(['geo.dailymotion.com','www.dailymotion.com'].includes(p.host)){
   const id=/\/video\/([a-z0-9]+)/i.exec(p.path)?.[1]??/[?&]video=([a-z0-9]+)/i.exec(p.path)?.[1];if(!id)throw Error('Invalid Dailymotion video identity.');identity(id);const data=await read('https://www.dailymotion.com/player/metadata/video/'+id,{json:true});if(data.error)throw Error('Dailymotion did not authorize playback.');headers={Referer:'https://geo.dailymotion.com/'};
   for(const [quality,items]of Object.entries(data.qualities??{}))for(const item of items){const type=/mpegurl/i.test(item.type??'')?'hls':/^video\/mp4/i.test(item.type??'')?'mp4':null;if(type)videos.push(rendition(item.url,ORIGIN,{type,quality,headers}));}
  }else if(p.host==='rumble.com'){
   const player=await read(p.value);let data;try{data=jsonAfter(player,/m\.f\[["'][^"']+["']\]\s*=\s*/);}catch{data=jsonAfter(player,/\b(?:var|let|const)\s+video\s*=\s*/);}headers={Referer:'https://rumble.com/'};
   const walk=(value,depth=0)=>{if(depth>15)return;if(value&&typeof value==='object'){if(typeof value.url==='string')try{videos.push(rendition(value.url,ORIGIN,{quality:value.height?value.height+'p':'auto',headers}));}catch{}for(const child of Object.values(value))walk(child,depth+1);}};walk(data);
  }else throw Error('DonghuaStream returned an unsupported player host.');
  results.push(result(server,[...new Map(videos.map(v=>[v.url,v])).values()],headers));
 }catch(error){failures.push(String(error.message??error));}}
 if(!results.length)throw Error(failures[0]??'DonghuaStream has no supported stream for this episode.');return results;
}},context);}
