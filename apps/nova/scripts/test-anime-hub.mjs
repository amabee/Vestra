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
await build({stdin:{contents:`export {animeHomeModel} from './apps/nova/shared/anime-lists';export {calendarWeek,localDateKey,parseCalendarDate} from './apps/nova/renderer/src/components/media/anime-hub-model';export {MemoryDriver,saveProgress,getAllProgress,addHistoryEntry,getHistory} from './packages/storage/src/index';export {mediaItemSchema,watchProgressSchema} from './packages/types/src/index';`,resolveDir:root},bundle:true,platform:"node",format:"cjs",outfile:join(scratch,"test.cjs")});
const {animeHomeModel,calendarWeek,localDateKey,parseCalendarDate,MemoryDriver,saveProgress,getAllProgress,addHistoryEntry,getHistory,mediaItemSchema,watchProgressSchema}=createRequire(import.meta.url)(join(scratch,"test.cjs"));
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
