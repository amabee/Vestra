import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(join(nova, "node_modules/.hub-ui-"));
try {
  await build({
    stdin: {
      contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider,useQueryClient} from '@tanstack/react-query';import {MemoryRouter,Routes,Route,useNavigate,useLocation} from 'react-router';import {HomeRoute} from './renderer/src/routes/home';import {DiscoverRoute} from './renderer/src/routes/discover';import {ScheduleRoute} from './renderer/src/routes/schedule';import {usePlayer} from './renderer/src/lib/player-store';import {usePlaybackPersistence} from './renderer/src/components/player/use-playback-persistence';
 function Probe(){fixture.navigate=useNavigate();fixture.location=useLocation();fixture.cache=useQueryClient();fixture.player=usePlayer();return null;}
 function Persistence(){const [input,setInput]=useState({item:fixture.item('persist'),episodeId:'ep-four',episodeNumber:4,sessionId:1,position:10,duration:100,ready:true});fixture.setPlayback=setInput;usePlaybackPersistence(input);return <p>Persistence fixture</p>;}
 createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,staleTime:0}}})}><MemoryRouter><Probe/><Routes><Route path='/' element={<HomeRoute/>}/><Route path='/discover' element={<DiscoverRoute/>}/><Route path='/schedule' element={<ScheduleRoute/>}/><Route path='/persistence' element={<Persistence/>}/></Routes></MemoryRouter></QueryClientProvider>);`,
      resolveDir: nova,
      loader: "tsx",
    },
    tsconfig: join(nova, "renderer/tsconfig.json"),
    bundle: true,
    format: "iife",
    outfile: join(scratch, "fixture.js"),
    plugins: [
      {
        name: "bridge-fixture",
        setup(build) {
          build.onResolve({ filter: /^@\/lib\/bridge$/ }, () => ({
            path: "fixture",
            namespace: "bridge-fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "bridge-fixture" }, () => ({
            contents: "export const bridge=window.fixtureBridge;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const css = (await readdir(join(nova, "dist-renderer/assets"))).find(
    (file) => file.startsWith("theme-") && file.endsWith(".css"),
  );
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html lang="en" data-theme="vestra"><head><link rel="stylesheet" href="${pathToFileURL(join(nova, "dist-renderer/assets", css)).href}"><link rel="stylesheet" href="${pathToFileURL(join(scratch, "fixture.css")).href}"></head><body><div id="root"></div><script>
 const poster=${JSON.stringify("data:image/png;base64," + (await readFile(join(nova, "build/icon.png"))).toString("base64"))};
 const item=id=>({source:'anilist',sourceId:id,kind:'anime',title:id==='watching'?'Watching Anime':id==='planned'?'Planned Anime':id==='completed'?'Completed Anime':id==='paused'?'Paused Anime':id==='persist'?'Persisted Anime':'Anime '+id,images:{poster,backdrop:null},rating:{score:85},genres:[{id:'action',name:'Action'}],year:2026,overview:'A real source supplies the synopsis and artwork for this catalogue title.',status:'airing',isSeries:true});
 const watch=(id,status)=>({ref:item(id),snapshot:item(id),status,addedAt:1,updatedAt:1});
 window.fixture={item,watchlist:[watch('watching','watching'),watch('planned','planned'),watch('completed','completed'),watch('paused','paused')],history:[],progress:{'anilist:anime:watching#stable-1':{ref:item('watching'),episodeId:'stable-1',episodeNumber:1,positionSeconds:30,durationSeconds:100,percent:.3,completed:false,updatedAt:10}},lists:[{id:'11111111-1111-4111-8111-111111111111',name:'Weekend anime',updatedAt:1,items:[{item:item('playlist'),provider:'ext-one'}]}],opens:[],saves:[],historyWrites:[],exploreCalls:[],scheduleCalls:[]};
 const titles=Array.from({length:16},(_,i)=>({item:item(String(i+1)),totalEpisodes:12,airedEpisodes:3,season:'FALL',format:'TV',releasing:true}));
 window.fixtureBridge={
 anime:{snapshots:async(ids)=>ids.map(id=>item(String(id))),sources:async()=>[{id:'ext-one',name:'First extension'},{id:'ext-two',name:'Second extension'}],open:async(source,item)=>{fixture.opens.push({source,item});return {item,queue:[{kind:'stream',locator:'vestra-stream://fixture',priority:80,progressId:'stable-1',episode:1,label:'Episode 1'}]};},explore:async(query)=>{fixture.exploreCalls.push(query);if(fixture.exploreFail)throw Error('Discovery offline');return {genres:['Action','Comedy'],sections:[{id:'trending',title:'Trending right now',items:fixture.exploreEmpty?[]:titles},{id:'season',title:'Top anime of Fall 2026',items:fixture.exploreEmpty?[]:titles.slice(0,6)},{id:'upcoming',title:'Coming soon',items:fixture.exploreEmpty?[]:titles.slice(4,10).map(t=>({...t,releasing:false,airedEpisodes:0,item:{...t.item,status:'upcoming'}}))},{id:'movies',title:'Top anime movies',items:fixture.exploreEmpty?[]:titles.slice(8,14).map(t=>({...t,format:'MOVIE',totalEpisodes:1,airedEpisodes:1,releasing:false,item:{...t.item,status:'released'}}))}]};},schedule:async(query)=>{fixture.scheduleCalls.push(query);if(fixture.scheduleFail)throw Error('Schedule offline');const events=[{id:'one',airingAt:query.from+3600,episode:2,item:item('watching'),status:'watching',watched:false},{id:'two',airingAt:query.from+90000,episode:1,item:item('planned'),status:'planned',watched:true}];return {events:fixture.scheduleEmpty?[]:events.filter(event=>query.status==='all'||event.status===query.status),tracked:2,unmatched:[],truncated:false};}},
 library:{files:async()=>[]},
 watchlist:{list:async()=>structuredClone(fixture.watchlist),add:async(item,status='planned')=>{const old=fixture.watchlist.find(row=>row.ref.sourceId===item.sourceId);if(old){old.status=status;old.updatedAt=Date.now();}else fixture.watchlist.push({ref:item,snapshot:item,status,addedAt:Date.now(),updatedAt:Date.now()});return structuredClone(fixture.watchlist);},remove:async()=>{}},
 history:{list:async()=>structuredClone(fixture.history),add:async(input)=>{fixture.historyWrites.push(input);return []; }},
 progress:{all:async()=>structuredClone(fixture.progress),save:async(input)=>{fixture.saves.push(input);const result={...input,percent:input.positionSeconds/input.durationSeconds,completed:input.positionSeconds/input.durationSeconds>=.9,updatedAt:Date.now()};fixture.progress[input.ref.source+':anime:'+input.ref.sourceId+'#'+input.episodeId]=result;return result;}},
 playlists:{list:async()=>fixture.lists,mutate:async()=>fixture.lists},
 };
 </script><script src="fixture.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    `
 const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');
 app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});app.commandLine.appendSwitch('disable-gpu');
 app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true,contextIsolation:false,nodeIntegration:false}});
 win.webContents.on("console-message",event=>{if(event.level==="error")console.error(event.message);});
 const run=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(error){throw Error(code+" | "+error.message);}};
 const until=async(code)=>{for(let i=0;i<200;i++){if(await run("Boolean("+code+")"))return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+code);};
 const click=label=>run('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.trim()==='+JSON.stringify(label)+').click()');
 const select=async(label,value)=>run('(()=>{const el=Array.from(document.querySelectorAll("select")).find(el=>el.getAttribute("aria-label")==='+JSON.stringify(label)+');el.value='+JSON.stringify(value)+';el.dispatchEvent(new Event("change",{bubbles:true}));})()');
 try{await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});
 await until('document.querySelector("#continue-heading") && document.querySelectorAll(".hub-card").length>=5');
 assert.equal(await run('document.querySelector("#list-watching-heading").textContent'),'Currently watching');
 assert.equal(await run('document.querySelector("#list-planned-heading").parentElement.parentElement.textContent.includes("Planned Anime")'),true);
 await run('Array.from(document.querySelectorAll("button")).find(button=>button.getAttribute("aria-label")==="Resume Watching Anime").click()');await until('fixture.opens.length===1');assert.equal(await run('fixture.opens[0].source'),'ext-one');await until('fixture.player.queue.length===1');assert.equal(await run('fixture.player.startAt'),30);
 await select('List status for Watching Anime','completed');await until('document.querySelector("#list-completed-heading").parentElement.parentElement.textContent.includes("Watching Anime")');
 await run('fixture.progress["anilist:anime:55#legacy"]={ref:fixture.item("55"),episodeId:"legacy",percent:.4,positionSeconds:40,durationSeconds:100,completed:false,updatedAt:40};fixture.cache.invalidateQueries({queryKey:["progress"]})');await until('document.getElementById("root").textContent.includes("Anime 55")');
 console.log('PASS Home saved-list shelves, status changes, real progress, legacy title recovery and resume handoff');
 await run('fixture.navigate("/discover?source=ext-two")');await until('document.querySelectorAll("#explore-trending-heading").length===1');
 assert.equal(await run('document.querySelectorAll(".hub-airing").length>0'),true);assert.equal(await run('document.querySelector(".hub-feature").textContent.includes("3 / 12 aired")'),true);
 await select('Genre','Action');await until('fixture.exploreCalls.at(-1).genre===\"Action\"');await select('Release year','2026');await until('fixture.exploreCalls.at(-1).year===2026');await select('Release status','FINISHED');await until('fixture.exploreCalls.at(-1).status===\"FINISHED\"');await select('Season','SUMMER');await until('fixture.exploreCalls.at(-1).season===\"SUMMER\"');await select('Format','MOVIE');
 await until('fixture.exploreCalls.at(-1).format==="MOVIE"');assert.equal(await run('fixture.exploreCalls.at(-1).genre'),'Action');assert.equal(await run('fixture.exploreCalls.at(-1).year'),2026);assert.equal(await run('fixture.location.search.includes("status=FINISHED")'),true);
 await run('Array.from(document.querySelectorAll("button")).find(button=>button.getAttribute("aria-label")==="Next Trending right now").click()');await until('document.querySelector("#explore-trending-heading").parentElement.parentElement.querySelector(".hub-carousel").scrollLeft>0');
 const old=await run('document.querySelector(".hub-feature h2").textContent');await run('Array.from(document.querySelectorAll("button")).find(button=>button.getAttribute("aria-label")==="Next featured anime").click()');assert.notEqual(await run('document.querySelector(".hub-feature h2").textContent'),old);
 await run('Array.from(document.querySelectorAll("button")).find(button=>button.getAttribute("aria-label")==="Save Anime 1 to Plan to watch").click()');await until('fixture.watchlist.some(row=>row.ref.sourceId==="1" && row.status==="planned")');
 await run('fixture.exploreFail=true;fixture.navigate("/discover?source=ext-two&q=failure")');await until('document.getElementById("root").textContent.includes("Discovery offline")');await run('fixture.exploreFail=false');await click('Retry discovery');await until('document.querySelector("#explore-trending-heading")');
 await run('fixture.exploreEmpty=true;fixture.navigate("/discover?source=ext-two&q=unmatched")');await until('document.getElementById("root").textContent.includes("No anime match these filters")');await run('fixture.exploreEmpty=false');await click('Reset filters');await until('!!document.querySelector("#explore-trending-heading")');
 console.log('PASS Discover dropdown filters, URL state, airing/count metadata, carousel, hero and saved-list actions');
 await run('fixture.navigate("/schedule?source=ext-two&date=2026-11-04&first=1")');await until('document.querySelectorAll(".hub-calendar-day").length===7');
 assert.equal(await run('document.querySelectorAll(".hub-calendar-event").length'),1);
 assert.equal(await run('document.querySelector(".hub-calendar-day h2").textContent'),'Mon');
 await run('document.querySelector("input[role=switch]").click()');await until('document.querySelectorAll(".hub-calendar-event").length===2');assert.equal(await run('fixture.location.search.includes("watched=true")'),true);
 await select('Schedule list status','planned');await until('document.querySelectorAll(".hub-calendar-event").length===1 && document.querySelector(".hub-calendar-event").textContent.includes("Planned Anime")');
 await select('Week begins','0');await until('document.querySelector(".hub-calendar-day h2").textContent==="Sun"');assert.equal(await run('localStorage.getItem("vestra-calendar-first-day")'),'0');
 const from=await run('fixture.scheduleCalls.at(-1).from');await run('Array.from(document.querySelectorAll("button")).find(button=>button.getAttribute("aria-label")==="Next week").click()');await until('fixture.scheduleCalls.at(-1).from>'+from);
 await run('fixture.scheduleEmpty=true');await run('Array.from(document.querySelectorAll("button")).find(button=>button.getAttribute("aria-label")==="Next week").click()');await until('document.getElementById("root").textContent.includes("No matching episodes this week")');await run('fixture.scheduleEmpty=false');
 await run('fixture.scheduleFail=true');await run('Array.from(document.querySelectorAll("button")).find(button=>button.getAttribute("aria-label")==="Next week").click()');await until('document.getElementById("root").textContent.includes("Schedule offline")');await run('fixture.scheduleFail=false');await click('Retry schedule');await until('document.querySelectorAll(".hub-calendar-day").length===7');
 console.log('PASS weekly calendar, week-begin preference, list status, watched switch, navigation and retries');
 if(process.env.VESTRA_HUB_SCREENSHOTS){const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(process.env.VESTRA_HUB_SCREENSHOTS,{recursive:true});for(const [name,url] of [['home','/?source=ext-one'],['discover','/discover?source=ext-one'],['schedule','/schedule?source=ext-one&date=2026-11-04&first=1&watched=true']]){await run('fixture.navigate('+JSON.stringify(url)+')');await until('document.querySelector(".hub-heading h1")?.textContent.toLowerCase()==='+JSON.stringify(name));for(const width of [1440,375]){win.setContentSize(width,900);await new Promise(r=>setTimeout(r,300));assert.equal(await run('document.documentElement.scrollWidth<=window.innerWidth'),true,name+' overflows '+width);fs.writeFileSync(path.join(process.env.VESTRA_HUB_SCREENSHOTS,name+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());}}}
 await run('fixture.watchlist.push({ref:fixture.item("persist"),snapshot:fixture.item("persist"),status:"planned",addedAt:1,updatedAt:1});fixture.navigate("/persistence")');await until('typeof fixture.setPlayback==="function"');
 await run('fixture.setPlayback(previous=>({...previous,position:45}))');await new Promise(r=>setTimeout(r,50));
 await run('fixture.setPlayback({item:fixture.item("persist"),episodeId:"ep-five",episodeNumber:5,sessionId:2,position:99,duration:100,ready:false})');await until('fixture.saves.some(save=>save.episodeId==="ep-four")');assert.equal(await run('fixture.saves.find(save=>save.episodeId==="ep-four").positionSeconds'),45);await until('fixture.watchlist.find(row=>row.ref.sourceId==="persist").status==="watching"');await run('fixture.watchlist.find(row=>row.ref.sourceId==="persist").status="completed"');
 await run('fixture.setPlayback(previous=>({...previous,position:30,ready:true}))');await new Promise(r=>setTimeout(r,50));await run('fixture.setPlayback({item:null,episodeId:null,episodeNumber:null,sessionId:3,position:0,duration:0,ready:false})');await until('fixture.historyWrites.some(save=>save.episodeId==="ep-five")');
 assert.equal(await run('fixture.saves.find(save=>save.episodeId==="ep-five").positionSeconds'),30);assert.equal(await run('fixture.historyWrites.find(save=>save.episodeId==="ep-five").episodeNumber'),5);
 assert.equal(await run('fixture.watchlist.find(row=>row.ref.sourceId==="persist").status'),'completed');
 console.log('PASS playback-session cleanup saves the previous episode and snapshot; unready sessions do not borrow old positions');
 win.destroy();app.exit(0);
 }catch(error){console.error(error);win.destroy();app.exit(1);}});
 `,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const code = await new Promise((resolve, reject) => {
    const child = spawn(require("electron"), [join(scratch, "runner.cjs")], {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Anime hub UI fixture timed out"));
    }, 90000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (code !== 0) throw Error(`Anime hub UI fixture failed (${code})`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
