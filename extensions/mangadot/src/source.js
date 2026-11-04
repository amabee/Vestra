// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {reader,pageOptions,asset,pages} from "../../../lib/manga-common.js";
const ORIGIN="https://mangadot.net",HOSTS=["mangadot.net"];
function identity(value){if(typeof value!=="string"||!/^[a-z0-9_-]{1,200}$/i.test(value))throw Error("Invalid MangaDot identity.");return value;}
export function activate({host}) {
 const read=reader(host,ORIGIN);
 async function searchPage(query,options={}){const {page,limit}=pageOptions(options),q=String(query).trim().slice(0,500);if(!q)return{items:[],hasMore:false};const data=await read(`/api/search?search=${encodeURIComponent(q)}&sortBy=relevance&sortOrder=desc&limit=${limit}&page=${page}`,true);if(!Array.isArray(data.manga_list)||data.manga_list.length>400)throw Error("Invalid MangaDot search results.");const total=data.total??data.pagination?.total;return{items:data.manga_list.map(row=>({id:identity(String(row.id)),title:String(row.title).slice(0,500),cover:asset(row.photo,ORIGIN,HOSTS,ORIGIN+'/')})),hasMore:typeof data.has_more==='boolean'?data.has_more:Number.isInteger(total)?page*limit<total:false};}
 return{searchPage,async search(q,o={}){return(await searchPage(q,{...o,page:1})).items;},
  async getChapters(value){const book=identity(value),data=await read(`/api/manga/${book}/chapters/list`,true);if(!Array.isArray(data)||data.length>10000)throw Error("Invalid MangaDot chapter list.");const found=new Map();for(const row of data){const id=identity(String(row.id));found.set(id,{id,title:String(row.chapter_title??`Chapter ${row.chapter_number}`).slice(0,500),number:String(row.chapter_number??"Special"),language:typeof row.language==='string'?row.language:undefined,scanlator:typeof row.group_name==='string'?row.group_name:undefined});}return[...found.values()].sort((a,b)=>Number(a.number)-Number(b.number)).map((row,index)=>({...row,index}));},
  async getPages(value){const id=identity(value),data=await read(`/api/uploads/${id}/images`,true);if(!data.images||typeof data.images!=='object'||Array.isArray(data.images))throw Error("Invalid MangaDot images.");const entries=Object.entries(data.images);if(entries.some(([key])=>!/^\d+$/.test(key)))throw Error("Invalid MangaDot image ordering.");return pages(entries.sort((a,b)=>Number(a[0])-Number(b[0])).map(([,row])=>row.url),ORIGIN,HOSTS,ORIGIN+'/');},
 };
}
