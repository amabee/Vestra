// Adapted from Seanime Providers (MIT), Copyright (c) 2025 Pal.
import {reader,pageOptions,asset,pages} from "../../../lib/manga-common.js";
import {flightData,jsonArray} from "../../../lib/rsc-data.js";
const ORIGIN="https://taiyo.moe",CDN="https://cdn.taiyo.moe",HOSTS=["taiyo.moe","cdn.taiyo.moe"];
// Public, search-only key published as NEXT_PUBLIC_MEILISEARCH_PUBLIC_KEY.
const SEARCH_KEY="48aa86f73de09a7705a2938a1a35e5a12cff6519695fcad395161315182286e5";
function identity(value){if(typeof value!=="string"||!/^[a-z0-9_-]{1,200}$/i.test(value))throw Error("Invalid Taiyo identity.");return value;}
export function activate({host}) {
 const read=reader(host,ORIGIN);
 async function searchPage(query,options={}) {
  const {page,limit}=pageOptions(options),q=String(query).trim().slice(0,500);if(!q)return{items:[],hasMore:false};
  const response=await host.fetch({url:"https://meilisearch.taiyo.moe/multi-search",method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${SEARCH_KEY}`},body:JSON.stringify({queries:[{indexUid:"medias",q,filter:["deletedAt IS NULL"],limit,offset:(page-1)*limit}]})});
  if(response.status!==200)throw Error(`Taiyo search returned HTTP ${response.status}.`);
  const data=JSON.parse(response.body)?.results?.[0];if(!Array.isArray(data?.hits)||data.hits.length>400)throw Error("Invalid Taiyo search response.");
  const items=data.hits.map(hit=>{const id=identity(hit.id),title=hit.titles?.find(t=>t.isMainTitle)?.title??hit.titles?.[0]?.title;if(typeof title!=="string"||!title.trim())throw Error("Taiyo title is missing.");return{id,title:title.slice(0,500),cover:hit.mainCoverId?asset(`${CDN}/medias/${id}/covers/${identity(hit.mainCoverId)}.jpg`,ORIGIN,HOSTS,ORIGIN+"/"):null};});
  const total=data.totalHits??data.estimatedTotalHits;if(!Number.isInteger(total)||total<0)throw Error("Taiyo search pagination is missing.");return{items,hasMore:page*limit<total};
 }
 return{searchPage,async search(q,o={}){return(await searchPage(q,{...o,page:1})).items;},
  async getChapters(value){const book=identity(value),found=new Map();let total=1;for(let page=1;page<=total;page++){
   const input=encodeURIComponent(JSON.stringify({"0":{json:{mediaId:book,page,perPage:100}}})),data=await read(`/api/trpc/chapters.getByMediaId?batch=1&input=${input}`,true),envelope=Array.isArray(data)?data[0]:data;
   const result=envelope?.result?.data?.json??envelope?.result?.data;if(!Array.isArray(result?.chapters))throw Error("Invalid Taiyo chapter response.");
   total=result.totalPages??result.pagination?.totalPages??1;if(!Number.isInteger(total)||total<1||total>100)throw Error("Invalid Taiyo chapter pagination.");
   let added=0;for(const c of result.chapters){const id=book+"|"+identity(c.id);if(!found.has(id)){found.set(id,{id,title:String(c.title??`Capítulo ${c.number}`).slice(0,500),number:String(c.number??"Special"),language:"pt"});added++;}}
   if(found.size>10000||page>1&&!added)throw Error("Taiyo chapter pagination repeated or exceeded its limit.");
  }return[...found.values()].sort((a,b)=>Number(a.number)-Number(b.number)).map((c,index)=>({...c,index}));},
  async getPages(value){const ids=String(value).split("|");if(ids.length!==2)throw Error("Invalid Taiyo chapter identity.");const [book,chapter]=ids.map(identity),path=`/chapter/${chapter}/1`,rows=jsonArray(flightData(await read(path)),"pages");return pages(rows.map(p=>{const ext=p.extension??"jpg";if(!/^(jpg|jpeg|png|webp|avif|gif)$/i.test(ext))throw Error("Unsupported Taiyo image extension.");return`${CDN}/medias/${book}/chapters/${chapter}/${identity(p.id)}.${ext}`;}),ORIGIN,HOSTS,ORIGIN+path);},
 };
}
