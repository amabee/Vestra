// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {elements,hasClass,links,text,url,rendition,result} from '../../../lib/anime-common.js';
import {htmlAnime} from '../../../lib/anime-html.js';
import {frames} from '../../../lib/anime-embed.js';
import {decodeBase64} from '../../../lib/base64.js';
// The upstream .ch mirror now redirects to this reviewed source origin.
const ORIGIN='https://animeunity.io';
export function activate(context){return htmlAnime({origin:ORIGIN,searchPath:q=>'/?s='+encodeURIComponent(q),bookPattern:/^\/anime\/[a-z0-9_-]+\/?$/i,episodePattern:/^\/(?!anime\/)[a-z0-9_-]+\/?$/i,cards:html=>elements(html,'div',a=>hasClass(a,'listupd')).flatMap(b=>elements(b.body,'article',a=>hasClass(a,'bs'))),episodeLinks:html=>elements(html,'div',a=>hasClass(a,'eplister')).flatMap(b=>links(b.body)),number:a=>Number.parseFloat(text(elements(a.body,'div',a=>hasClass(a,'epl-num'))[0]?.body)),async streams(path,read,options){if(options.excludeServers?.includes('AnimeUnity'))throw Error('No untried AnimeUnity server remains.');const html=await read(path),frame=frames(html).map(raw=>url(raw,ORIGIN)).find(p=>p?.host==='anixo.net'&&p.path.startsWith('/embed.html?data='));if(!frame)throw Error('AnimeUnity player data is missing.');const encoded=/[?&]data=([^&]+)/.exec(frame.path)?.[1];if(!encoded)throw Error('AnimeUnity stream data is missing.');const media=decodeBase64(decodeURIComponent(encoded));return[result('AnimeUnity',[rendition(media,ORIGIN,{headers:{Referer:ORIGIN+'/'}})])];}},context);}
