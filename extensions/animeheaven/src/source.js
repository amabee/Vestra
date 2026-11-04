// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {request,identity,titles,episodes,rendition,result,links,images,elements,hasClass,text,attrs} from "../../../lib/anime-common.js";
const ORIGIN="https://animeheaven.me",UA="Mozilla/5.0";
export function activate({host}) {
 const fetch=request(host,ORIGIN),read=(path,options={})=>fetch(path,{...options,headers:{'User-Agent':UA,...options.headers}});
 return{
  async search(query,options={}){const q=String(query).trim().slice(0,500);if(!q)return[];const html=await read('/search.php?s='+encodeURIComponent(q)),rows=[];for(const block of elements(html,'div',a=>hasClass(a,'similarimg'))){const a=links(block.body).find(a=>/^\/?anime\.php\?[a-z0-9]+$/i.test(a.href));if(!a)continue;const id=a.href.split('?')[1],img=images(a.body)[0],title=text(img?.alt??a.title);if(title)rows.push({id,title,url:ORIGIN+'/anime.php?'+id});}return titles(rows,options.limit);},
  async getEpisodes(value){const book=identity(value),html=await read('/anime.php?'+book),rows=[];for(const a of links(html)){if(!a.id||!/^gate\.php$/i.test(a.href))continue;const label=elements(a.body,'div',a=>hasClass(a,'watch2'))[0];if(!label)continue;const number=Number(text(label.body));if(!/^\d+(?:\.\d+)?$/.test(text(label.body)))continue;rows.push({id:book+'|'+identity(a.id),number,title:'Episode '+number,url:ORIGIN+'/gate.php'});}return episodes(rows,book);},
  async getStreams(value,options={}){const ids=String(value).split('|');if(ids.length!==2)throw Error('Invalid AnimeHeaven episode identity.');const [book,key]=ids.map(v=>identity(v));if(options.excludeServers?.includes('AnimeHeaven'))throw Error('No untried AnimeHeaven server remains.');const html=(await read('/gate.php',{headers:{Cookie:'key='+key,Referer:ORIGIN+'/anime.php?'+book}})).replace(/<!--[\s\S]*?-->/g,''),video=elements(html,'video',a=>a.id==='vid')[0];let media;
   if(video){for(const m of video.body.matchAll(/<source\b([^>]*)>/gi)){const src=attrs(m[1]).src;if(/\.mp4(?:[?#]|$)/i.test(src??'')){media=src;break;}}}
   if(!media)media=links(html).find(a=>/Download\s+Episode\b/i.test(a.text)&&/\/video\.mp4(?:[?#]|$)/i.test(a.href))?.href;
   if(!media)throw Error('AnimeHeaven did not provide a playable video.');const headers={Referer:ORIGIN+'/',Origin:ORIGIN};return[result('AnimeHeaven',[rendition(media,ORIGIN,{type:'mp4',headers})],headers)];
  },
 };
}
