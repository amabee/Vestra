// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {request,identity,titles,episodes,rendition,result,mediaUrl} from '../../../lib/anime-common.js';
import {decodeSvelte} from '../../../lib/svelte-data.js';
const SITE='https://animeunion.tv',API='https://api.animeunion.tv';
export function activate({host}){
 const read=request(host,SITE),api=request(host,API);
 return{
  async search(query,options={}){const q=String(query).trim().slice(0,500);if(!q)return[];const data=await api('/api/v1/anime?q='+encodeURIComponent(q)+'&limit=50',{json:true});if(!Array.isArray(data.data))throw Error('Invalid AnimeUnion search results.');return titles(data.data.filter(row=>Number(row.episodeCount)>0).map(row=>{const id=identity(row.slug);let cover;try{if(row.coverImage)cover=mediaUrl(row.coverImage,SITE);}catch{}return{id,title:row.titleEng||row.title||row.titleIta,url:SITE+'/anime/'+id,...(cover?{cover}:{})};}),options.limit);},
  async getEpisodes(value){const book=identity(value),data=await api('/api/v1/anime/'+book,{json:true}),count=Number((data.data??data).episodeCount);if(!Number.isInteger(count)||count<1||count>5000)throw Error('AnimeUnion episode inventory is missing.');return episodes(Array.from({length:count},(_,i)=>({id:book+'|'+(i+1),number:i+1,url:SITE+'/anime/'+book+'/'+(i+1)})),book);},
  async getStreams(value,options={}){const parts=String(value).split('|');if(parts.length!==2||!/^\d+(?:\.\d+)?$/.test(parts[1]))throw Error('Invalid AnimeUnion episode identity.');const [book,number]=[identity(parts[0]),parts[1]],page=decodeSvelte(await read('/anime/'+book+'/'+number+'/__data.json?x-sveltekit-invalidated=01',{json:true})),rows=page?.episode?.streamLinks;if(!Array.isArray(rows))throw Error('AnimeUnion stream links are missing.');const results=[],headers={Origin:SITE,Referer:SITE+'/'};
   for(const [prefix,server]of [['SUB','Sub'],['DUB','Dub']]){if(options.excludeServers?.includes(server))continue;const videos=[];for(const row of rows){if(row?.isActive===false||!String(row?.language??'').toUpperCase().startsWith(prefix))continue;const quality=String(row.quality??'auto').replace(/^Q_/i,'').replace(/(\d+)P$/i,'$1p');videos.push(rendition(row.url,SITE,{quality,headers}));}if(videos.length)results.push(result(server,[...new Map(videos.map(v=>[v.url,v])).values()],headers));}
   if(!results.length)throw Error('AnimeUnion has no available sub/dub stream for this episode.');return results;
  },
 };
}
