// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {request,sourcePath,identity,titles,episodes,rendition,result,links,elements,hasClass,text,attrs,literal} from "../../../lib/anime-common.js";
const ORIGIN="https://www.animegg.org";
export function activate({host}) {
 const read=request(host,ORIGIN);
 return{
  async search(query,options={}){const q=String(query).trim().slice(0,500);if(!q)return[];const html=await read('/search/?q='+encodeURIComponent(q)),rows=[];for(const a of links(html)){if(!hasClass(a,'mse'))continue;const path=sourcePath(a.href,ORIGIN,/^\/series\/[a-z0-9_-]+\/?$/i),title=text(elements(a.body,'h2')[0]?.body??a.title);if(title)rows.push({id:path.replace(/^\/series\//,'').replace(/\/$/,''),title,url:ORIGIN+path});}return titles(rows,options.limit);},
  async getEpisodes(value){const book=identity(value),html=await read('/series/'+book),rows=[];for(const a of links(html)){if(!hasClass(a,'anm_det_pop'))continue;const path=sourcePath(a.href,ORIGIN,/^\/[a-z0-9_-]+-episode-\d+(?:\.\d+)?(?:-[a-z0-9_-]+)?\/?$/i),n=/-episode-(\d+(?:\.\d+)?)/i.exec(path);if(n)rows.push({id:path,number:Number(n[1]),title:text(elements(a.body,'i',a=>hasClass(a,'anititle'))[0]?.body)||`Episode ${n[1]}`,url:ORIGIN+path});}return episodes(rows,book);},
  async getStreams(value,options={}){const path=sourcePath(value,ORIGIN,/^\/[a-z0-9_-]+-episode-\d+(?:\.\d+)?(?:-[a-z0-9_-]+)?\/?$/i),html=await read(path),results=[],failures=[];
   for(const [id,server] of [['subbed-Animegg','GG-SUB'],['dubbed-Animegg','GG-DUB']]){if(options.excludeServers?.includes(server))continue;const tab=elements(html,'div',a=>a.id===id)[0];if(!tab)continue;
    try{const frame=/<iframe\b([^>]*)>/i.exec(tab.body),embed=sourcePath(attrs(frame?.[1]).src,ORIGIN,/^\/[^\s#]{1,480}$/),body=await read(embed),array=/\b(?:var|let|const)\s+videoSources\s*=\s*(\[[\s\S]*?\])/.exec(body)?.[1];if(!array)throw Error("AnimeGG player source data is missing.");
     const videos=[];for(const m of array.matchAll(/\{([^{}]*)\}/g)){const file=/\bfile\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(m[1]),label=/\blabel\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/.exec(m[1]);if(file)videos.push(rendition(literal(file[1]),ORIGIN,{quality:label?literal(label[1]):'auto',type:'mp4',headers:{Referer:ORIGIN+'/'} }));}results.push(result(server,videos,{Referer:ORIGIN+'/'}));
    }catch(error){failures.push(String(error.message??error));}}
   if(!results.length)throw Error(failures[0]??"AnimeGG has no available sub/dub server for this episode.");return results;
  },
 };
}
