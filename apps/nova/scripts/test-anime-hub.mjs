import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const scratch=await mkdtemp(join(root,"apps/nova/node_modules/.anime-hub-"));
after(()=>rm(scratch,{recursive:true,force:true}));
await build({stdin:{contents:`export {AnimeSchedule} from './apps/nova/electron/anime-schedule';export {animeHomeModel} from './apps/nova/shared/anime-lists';export {calendarWeek,localDateKey,parseCalendarDate} from './apps/nova/renderer/src/components/media/anime-hub-model';export {MemoryDriver,saveProgress,getAllProgress,addHistoryEntry,getHistory} from './packages/storage/src/index';export {mediaItemSchema,watchProgressSchema} from './packages/types/src/index';`,resolveDir:root},bundle:true,platform:"node",format:"cjs",outfile:join(scratch,"test.cjs")});
const {AnimeSchedule,animeHomeModel,calendarWeek,localDateKey,parseCalendarDate,MemoryDriver,saveProgress,getAllProgress,addHistoryEntry,getHistory,mediaItemSchema,watchProgressSchema}=createRequire(import.meta.url)(join(scratch,"test.cjs"));
const item=(id)=>mediaItemSchema.parse({source:"anilist",sourceId:id,kind:"anime",title:"Anime "+id,images:{},rating:{},isSeries:true});
const saved=(snapshot,status)=>({ref:snapshot,snapshot,status,addedAt:0,updatedAt:0});
const watch=(ref,percent,updatedAt)=>({ref,percent,updatedAt,completed:percent>=.9,durationSeconds:100,positionSeconds:percent*100});
test("Home uses real progress, history-only snapshots and playlists without merging distinct list statuses",()=>{
 const a=item("1"),b=item("2"),c=item("3"),d=item("4");
 const model=animeHomeModel([saved(a,"watching"),saved(b,"paused"),saved(d,"completed")],[{ref:c,snapshot:c,positionSeconds:30}],[{items:[{item:c}]}],{a:watch(a,.3,10),b:watch(b,.4,20),d:watch(d,.5,30),c:watch(c,.4,40)});
 assert.deepEqual(model.continueWatching.map(r=>r.item.sourceId),["3","1"]);
 assert.equal(model.groups.find(g=>g.status==="paused").items[0].item.sourceId,"2");
 assert.equal(model.groups.find(g=>g.status==="completed").items[0].item.sourceId,"4");
 assert.equal(model.groups.flatMap(g=>g.items).length,4);
});
test("a later completed episode suppresses stale older partial progress; unstarted playlist titles are planned",()=>{
 const a=item("1"),b=item("2");const model=animeHomeModel([],[],[{items:[{item:a},{item:b}]}],{old:watch(a,.2,1),new:watch(a,1,2)});
 assert.equal(model.continueWatching.length,0);
 assert.equal(model.groups.find(g=>g.status==="watching").items[0].item.sourceId,"1");
 assert.equal(model.groups.find(g=>g.status==="planned").items[0].item.sourceId,"2");
});
test("episode numbers and history snapshots persist without changing progress keys or legacy shapes",async()=>{
 const driver=new MemoryDriver(),ref=item("1");
 await saveProgress(driver,{ref,episodeId:"stream-stable",episodeNumber:4,positionSeconds:95,durationSeconds:100});
 await saveProgress(driver,{ref,episodeId:"stream-stable",positionSeconds:96,durationSeconds:100});
 const all=await getAllProgress(driver);assert.equal(all["anilist:anime:1#stream-stable"].episodeNumber,4);
 await addHistoryEntry(driver,{item:ref,episodeId:"stream-stable",episodeNumber:4,positionSeconds:96,completed:true});
 const history=await getHistory(driver);assert.equal(history[0].episodeNumber,4);assert.equal(history[0].snapshot.title,ref.title);
 assert.equal(watchProgressSchema.safeParse({...watch(ref,.5,1),episodeId:"legacy"}).success,true);
 assert.equal(watchProgressSchema.safeParse({...watch(ref,.5,1),episodeNumber:-1}).success,false);
});
test("calendar boundaries honor the chosen first day, year changes and invalid dates",()=>{
 const week=calendarWeek(new Date(2026,0,1,12),1);
 assert.equal(localDateKey(week.start),"2025-12-29");assert.equal(localDateKey(week.end),"2026-01-05");
 assert.equal(calendarWeek(new Date(2026,10,1,12),0).start.getDay(),0);
 const fallback=new Date(2026,10,1,12);assert.equal(localDateKey(parseCalendarDate("2026-02-31",fallback)),"2026-11-01");
 assert.equal(week.days.length,7);
});

const emptySaved=()=>({watchlist:[],history:[],playlists:[],progress:{}});
test("schedule never queries the global airing catalogue for an empty saved list",async()=>{
 const service=new AnimeSchedule(async()=>emptySaved(),async()=>{throw Error("Unexpected network request")});
 assert.equal((await service.load({from:100,until:200})).events.length,0);
});
test("schedule filters saved IDs, preserves boundaries, and recomputes watched flags over cached broadcasts",async()=>{
 const a=item("1");const data={...emptySaved(),watchlist:[saved(a,"watching")],progress:{tagged:{...watch(a,1,1),episodeNumber:2},legacy:{...watch(a,1,2),episodeId:"opaque-hash"}}};let calls=0;
 const service=new AnimeSchedule(async()=>data,async(_query,variables)=>{calls++;assert.deepEqual(variables.ids,[1]);return {Page:{pageInfo:{hasNextPage:false},airingSchedules:[{id:1,mediaId:1,episode:2,airingAt:100},{id:2,mediaId:1,episode:3,airingAt:150},{id:3,mediaId:1,episode:4,airingAt:200}]}};});
 const first=await service.load({from:100,until:200});assert.equal(first.events.length,2);assert.equal(first.events[0].watched,true);assert.equal(first.events[1].watched,false);
 data.progress.tagged.completed=false;assert.equal((await service.load({from:100,until:200})).events[0].watched,false);assert.equal(calls,1);
 assert.equal((await service.load({from:100,until:200,status:"planned"})).tracked,0);assert.equal(calls,1);
 await assert.rejects(service.load({from:200,until:100}));await assert.rejects(service.load({from:100,until:100+9*86400}));
});
test("external saved titles need a unique exact metadata match, not fuzzy guesses",async()=>{
 const exact={...item("owned"),source:"ext-demo",title:"Exact Anime"};const ambiguous={...item("ambiguous"),source:"ext-demo",title:"Other Anime"};let lookups=0;
 const data={...emptySaved(),watchlist:[saved(exact,"planned"),saved(ambiguous,"watching")]};
 const service=new AnimeSchedule(async()=>data,async(query,variables)=>{
  if(query.includes("MatchSavedAnime")){lookups++;return {m0:{media:[{id:5,title:{english:"Other Anime"}},{id:6,title:{english:"Other Anime"}}]},m1:{media:[{id:4,title:{romaji:"Exact Anime"}}]}};}
  assert.deepEqual(variables.ids,[4]);return {Page:{pageInfo:{hasNextPage:false},airingSchedules:[{id:11,mediaId:4,episode:1,airingAt:150}]}};
 });
 const result=await service.load({from:100,until:200});assert.equal(result.events[0].item.source,"ext-demo");assert.equal(result.events[0].item.sourceId,"owned");assert.deepEqual(result.unmatched,["Other Anime"]);
 await service.load({from:100,until:200});assert.equal(lookups,1);
});
test("calendar uses local date arithmetic across daylight-saving changes",()=>{
 const old=process.env.TZ;try{process.env.TZ="America/New_York";
 const week=calendarWeek(new Date(2026,2,8,12),1);
 assert.equal(localDateKey(week.start),"2026-03-02");assert.equal(localDateKey(week.end),"2026-03-09");
 if(week.start.getTimezoneOffset()!==week.end.getTimezoneOffset())assert.equal((week.end-week.start)/3600000,167);
 }finally{if(old==null)delete process.env.TZ;else process.env.TZ=old;}
});
