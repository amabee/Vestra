import { build } from "esbuild";
import { deflateSync } from "node:zlib";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(join(nova, "node_modules/.screen-ui-"));
try {
  await build({
    stdin: {
      contents: `import {DEFAULT_SETTINGS} from "@vestra/types";window.fixtureDefaults=structuredClone(DEFAULT_SETTINGS);import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider,useQueryClient} from '@tanstack/react-query';import {MemoryRouter,Routes,Route,useNavigate,useLocation} from 'react-router';import {BrowseRoute} from './renderer/src/routes/browse';import {DetailRoute} from './renderer/src/routes/detail';import {usePlayer} from './renderer/src/lib/player-store';
    function Probe(){fixture.navigate=useNavigate();fixture.location=useLocation();fixture.cache=useQueryClient();fixture.player=usePlayer();return null;}
    createRoot(document.getElementById('root')).render(<React.Profiler id='screen' onRender={(_id,_phase,duration)=>{fixture.commits=(fixture.commits??0)+1;fixture.renderMs=(fixture.renderMs??0)+duration;}}><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,staleTime:0}}})}><MemoryRouter initialEntries={['/films']}><Probe/><Routes><Route path='/films' element={<BrowseRoute kind='movie' title='Films' lead='Catalogue'/>}/><Route path='/series' element={<BrowseRoute kind='tv' title='Series' lead='Catalogue'/>}/><Route path='/media/:source/:kind/:id' element={<DetailRoute/>}/></Routes></MemoryRouter></QueryClientProvider></React.Profiler>);`,
      resolveDir: nova,
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    tsconfig: join(nova, "renderer/tsconfig.json"),
    outfile: join(scratch, "fixture.js"),
    plugins: [
      {
        name: "fixture-bridge",
        setup(build) {
          build.onResolve({ filter: /^@\/lib\/bridge$/ }, () => ({
            path: "fixture",
            namespace: "fixture-bridge",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture-bridge" }, () => ({
            contents: "export const bridge=window.fixtureBridge;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const theme = (await readdir(join(nova, "dist-renderer/assets"))).find(
    (file) => file.startsWith("theme-") && file.endsWith(".css"),
  );
  const poster =
    "data:image/png;base64," +
    (await readFile(join(nova, "build/icon.png"))).toString("base64");
  const crc32 = (bytes) => {
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  };
  const pngChunk = (kind, data) => {
    const type = Buffer.from(kind);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([length, type, data, crc]);
  };
  const width = 1200,
    height = 1800;
  const pixels = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (1 + width * 4) + 1 + x * 4;
      pixels[offset] = x % 256;
      pixels[offset + 1] = y % 256;
      pixels[offset + 2] = (x + y) % 256;
      pixels[offset + 3] = 255;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const livePosters = process.env.VESTRA_SCREEN_LIVE_POSTERS
    ? JSON.parse(
        await readFile(process.env.VESTRA_SCREEN_LIVE_POSTERS, "utf8"),
      ).map((row) => row.cover)
    : [];
  const hdPoster =
    "data:image/png;base64," +
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(pixels)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]).toString("base64");
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html lang="en" data-theme="vestra"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(join(nova, "dist-renderer/assets", theme)).href}"><link rel="stylesheet" href="${pathToFileURL(join(scratch, "fixture.css")).href}"></head><body style="margin:0"><main id="root" style="height:100vh;overflow-y:auto"></main><script>
    const item=(kind='tv')=>({source:'ext-screen',sourceId:kind==='movie'?'film':'show',kind,title:kind==='movie'?'Example Film':'Example Series',images:{poster:${JSON.stringify(poster)},backdrop:null},rating:{score:null},year:2025,genres:[],isSeries:kind==='tv',seasons:[],studios:[],cast:[],related:[],streaming:[],countries:[],languages:[]});
    const queue=[{kind:'stream',locator:'vestra-stream://first',progressId:'stable-s1e1',episode:1,season:1,label:'Pilot',priority:80},{kind:'stream',locator:'vestra-stream://second',progressId:'stable-s2e1',episode:1,season:2,label:'Return',priority:80}];
    window.fixture={item,livePosters:${JSON.stringify(livePosters)},hdPoster:${JSON.stringify(hdPoster)},requests:[],failMore:true,sources:[{id:'ext-screen',name:'Screen fixture',categories:['popular','latest']},{id:'ext-other',name:'Other fixture',categories:[]}],progress:{'ext-screen:tv:show#stable-s2e1':{percent:.3,positionSeconds:30,durationSeconds:100,completed:false,updatedAt:2}},bookmarks:{},saves:[],bookmarkWrites:[],watchlist:[]};
    window.fixtureBridge={settings:{get:async()=>structuredClone(fixtureDefaults)},screen:{sources:async()=>fixture.sources,browse:async(request)=>{fixture.requests.push(request);if(fixture.slow&&request.source==='ext-other'){await new Promise(resolve=>fixture.releaseSlow=resolve);}if(fixture.bulk)return {items:Array.from({length:request.limit??24},(_,index)=>({...item(request.kind),source:request.source,sourceId:'bulk-'+request.page+'-'+index,images:{poster:(fixture.livePosters[(request.page-1)*14+index]??(request.page<=2?fixture.hdPoster+'#'+request.page+'-'+index:item(request.kind).images.poster))},title:'Stress title '+request.page+' '+index})),hasMore:request.page<100};if(fixture.fail||fixture.failSource===request.source)throw Error('Source offline');if(request.page===2&&fixture.failMore)throw Error('Next page offline');return {items:fixture.empty?[]:request.page===2?(request.category==='latest'?[item(request.kind)]:[item(request.kind),{...item(request.kind),sourceId:'extra',title:'Another title'}]):[request.source==='ext-other'?{...item(request.kind),source:'ext-other',sourceId:'other-title',title:'Other catalogue title'}:item(request.kind)],hasMore:!request.query&&request.page<(fixture.long?3:2)};}},media:{details:async ref=>item(ref.kind),resolvePlayback:async(ref,provider)=>{fixture.lastPlaybackProvider=provider;return queue;},trending:async()=>[]},library:{files:async()=>[],onChanged:()=>()=>{}},watchlist:{list:async()=>structuredClone(fixture.watchlist),add:async(item,status)=>{fixture.watchlist.push({ref:item,snapshot:item,status});return fixture.watchlist;}},progress:{all:async()=>structuredClone(fixture.progress),save:async(input)=>{fixture.saves.push(input);fixture.progress[input.ref.source+':'+input.ref.kind+':'+input.ref.sourceId+'#'+input.episodeId]={...input,percent:input.positionSeconds/input.durationSeconds,completed:input.positionSeconds>=input.durationSeconds};return fixture.progress[input.ref.source+':'+input.ref.kind+':'+input.ref.sourceId+'#'+input.episodeId];}},bookmarks:{all:async()=>structuredClone(fixture.bookmarks),toggle:async(input)=>{fixture.bookmarkWrites.push(input);const key=input.ref.source+':'+input.ref.kind+':'+input.ref.sourceId+'#'+input.episodeId;fixture.bookmarks[key]={ref:input.ref,episodeId:input.episodeId};return fixture.bookmarks;}},history:{list:async()=>[]}};
    const NativeImage=window.Image;fixture.imageCreates=0;window.Image=function(...args){fixture.imageCreates++;return new NativeImage(...args);};window.Image.prototype=NativeImage.prototype;
    </script><script src="./fixture.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    `const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});app.commandLine.appendSwitch('disable-gpu');
    app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{offscreen:true,contextIsolation:false,nodeIntegration:false}});
    const run=async code=>{try{return await win.webContents.executeJavaScript(code);}catch(error){throw Error(code+' | '+error.message);}};const until=async code=>{for(let i=0;i<200;i++){if(await run('Boolean('+code+')'))return;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out: '+code);};
    const click=text=>run('Array.from(document.querySelectorAll("button")).find(el=>el.textContent.trim()==='+JSON.stringify(text)+').click()');
    try{await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});await until('document.querySelectorAll(".screen-card").length===1');
    assert.equal(await run('fixture.requests.at(-1).kind'),'movie');assert.equal(await run('document.querySelector(".screen-card h2").textContent'),'Example Film');
    await until('document.body.textContent.includes("Next page offline")');assert.equal(await run('document.querySelectorAll(".screen-card").length'),1);await run('fixture.failMore=false');await click('Retry loading more');await until('document.querySelectorAll(".screen-card").length===2');await until('document.body.textContent.includes("All available titles loaded")');assert.equal(await run('fixture.requests.filter(r=>r.page===2).length'),2);
    await run('fixture.long=true;fixture.navigate("/films?category=latest")');await until('fixture.requests.at(-1).category==="latest"&&fixture.requests.at(-1).page===3');await new Promise(r=>setTimeout(r,150));assert.equal(await run('fixture.requests.filter(r=>r.category==="latest").length'),3);await run('fixture.long=false');
    await run('(()=>{const input=document.querySelector(".screen-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Example");input.dispatchEvent(new Event("input",{bubbles:true}));})()');await click('Search');await until('fixture.requests.at(-1).query==="Example"');assert.equal(await run('fixture.location.search.includes("q=Example")'),true);
    assert.equal(await run('document.querySelectorAll(".screen-provider").length'),0);
    await click('Load more');    assert.equal(await run('new Set(fixture.requests.filter(r=>r.query==="Example").map(r=>r.source)).size'),2);await until('document.querySelectorAll(".screen-card").length===2');
    await run('fixture.navigate("/series")');await until('fixture.requests.at(-1).kind==="tv" && document.querySelector(".screen-card h2")?.textContent==="Example Series"');
    for(const width of [1440,375]){win.setContentSize(width,900);await new Promise(r=>setTimeout(r,100));assert.equal(await run('document.documentElement.scrollWidth<=window.innerWidth'),true,'Browse overflow '+width);if(process.env.VESTRA_SCREEN_SCREENSHOTS){const fs=require('node:fs');fs.mkdirSync(process.env.VESTRA_SCREEN_SCREENSHOTS,{recursive:true});fs.writeFileSync(require('node:path').join(process.env.VESTRA_SCREEN_SCREENSHOTS,'series-'+width+'.png'),(await win.webContents.capturePage()).toPNG());}}
    console.log('PASS movie/TV source browsing, search, infinite loading, deduplication, next-page retry and responsive poster grids');
    await run('document.querySelector(".screen-card").click()');await until('document.querySelectorAll("article").length===2');await until('Array.from(document.querySelectorAll("button")).some(el=>el.getAttribute("aria-label")==="Resume Return")');
    await run('Array.from(document.querySelectorAll("button")).find(el=>el.getAttribute("aria-label")==="Resume Return").click()');await until('fixture.player.item');assert.equal(await run('fixture.player.index'),1);assert.equal(await run('fixture.player.startAt'),30);
    await run('(()=>{const el=Array.from(document.querySelectorAll("select")).find(el=>el.getAttribute("aria-label")==="Episode season");el.value="2";el.dispatchEvent(new Event("change",{bubbles:true}));})()');await until('document.querySelectorAll("article").length===1');
    assert.equal(await run('Boolean(document.querySelector(".screen-details .anime-hero .anime-primary"))'),true);
    await run('Array.from(document.querySelectorAll(".screen-provider-options button")).find(el=>el.textContent==="Other fixture").click()');await until('fixture.lastPlaybackProvider==="ext-other"');
    await run('Array.from(document.querySelectorAll(".screen-provider-options button")).find(el=>el.textContent==="Screen fixture").click()');await until('document.querySelector(".screen-provider-options [aria-pressed=true]").textContent==="Screen fixture"');

    await until('document.querySelector("input.screen-episode-search")');
    await run('(()=>{const el=document.querySelector("select[aria-label*=season]");el.value="2";el.dispatchEvent(new Event("change",{bubbles:true}));})()');await until('document.querySelectorAll("article").length===1');
    await run('(()=>{const input=document.querySelector("input.screen-episode-search");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"no match");input.dispatchEvent(new Event("input",{bubbles:true}));})()');await until('document.body.textContent.includes("No episodes match your search.")');
    await run('(()=>{const input=document.querySelector("input.screen-episode-search");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"");input.dispatchEvent(new Event("input",{bubbles:true}));})()');await until('document.querySelectorAll("article").length===1');
    await run('Array.from(document.querySelectorAll("button")).find(el=>el.getAttribute("aria-label")==="Bookmark Return").click()');await until('fixture.bookmarkWrites.length===1');assert.equal(await run('fixture.bookmarkWrites[0].episodeId'),'stable-s2e1');
    await run('Array.from(document.querySelectorAll("button")).find(el=>el.getAttribute("aria-label")==="Mark Return watched").click()');await until('fixture.saves.length===1');assert.equal(await run('fixture.saves[0].episodeId'),'stable-s2e1');
    await click('Plan to watch');await until('fixture.watchlist.length===1');await until('document.body.textContent.includes("Saved to your list")');assert.equal(await run('fixture.watchlist[0].ref.kind'),'tv');
    assert.equal(await run('document.documentElement.scrollWidth<=window.innerWidth'),true,'Details overflow mobile: '+JSON.stringify(await run('({width:innerWidth,scroll:document.documentElement.scrollWidth,x:scrollX,body:document.body.scrollWidth})'))+JSON.stringify(await run('Array.from(document.querySelectorAll("#root *")).filter(el=>el.getBoundingClientRect().right>window.innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent.slice(0,60)})).slice(0,8)')));
    if(process.env.VESTRA_SCREEN_SCREENSHOTS)require('node:fs').writeFileSync(require('node:path').join(process.env.VESTRA_SCREEN_SCREENSHOTS,'details-375.png'),(await win.webContents.capturePage()).toPNG());
    console.log('PASS season selection, independent episode resume, bookmarks, watched state and list saving');

    await run('fixture.navigate("/films")');await until('document.querySelector(".screen-search")');
    await run('fixture.sources=[];fixture.cache.invalidateQueries({queryKey:["screen-sources"]})');await until('document.body.textContent.includes("Bring your own movie source")');
    await run('fixture.sources=[{id:"ext-screen",name:"Screen fixture",categories:["popular"]}];fixture.fail=true;fixture.navigate("/films?source=ext-screen&q=offline");fixture.cache.invalidateQueries({queryKey:["screen-sources"]})');await until('document.body.textContent.includes("Source offline")');await run('fixture.fail=false');await click('Retry');await until('document.querySelectorAll(".screen-card").length===1');
    await run('fixture.failSource="ext-screen";fixture.cache.removeQueries({queryKey:["screen-batches"]});fixture.sources.push({id:"ext-other",name:"Other fixture",categories:["popular"]});fixture.cache.invalidateQueries({queryKey:["screen-sources"]});fixture.navigate("/films?category=popular")');await until('document.querySelector(".screen-search")');await click('Refresh titles');await until('document.body.textContent.includes("Some providers could not load")');await until('document.querySelectorAll(".screen-card").length>0');assert.equal(await run('document.querySelectorAll(".screen-provider").length'),0);
    console.log('PASS empty installation state, failure retry and combined results when one provider is offline');
    await run('fixture.failSource="";fixture.slow=true;fixture.navigate("/films?q=slow-check")');await until('document.querySelectorAll(".screen-card").length===1');await click('Load more');await until('fixture.releaseSlow');assert.equal(await run('document.querySelector(".screen-card h2").textContent'),"Example Film");await run('fixture.slow=false;fixture.releaseSlow()');await until('document.querySelectorAll(".screen-card").length===2');
    console.log('PASS fast provider renders before delayed provider completes');
    win.setContentSize(1440,900);
    await run('fixture.bulk=true;fixture.sources=[{id:"ext-screen",name:"Screen fixture",categories:["popular"]}];fixture.cache.invalidateQueries({queryKey:["screen-sources"]});fixture.navigate("/films?category=popular&stress=1");fixture.cache.removeQueries({queryKey:["screen-batches"]})');
    await until('fixture.cache.getQueryData(["screen-sources","movie"])?.length===1');
    await click('Refresh titles');
    await until('Number(document.querySelector(".screen-virtual-grid")?.dataset.totalTitles)===14');
    await new Promise(r=>setTimeout(r,150));assert.equal(await run('Number(document.querySelector(".screen-virtual-grid").dataset.totalTitles)'),14,"No extra batch before scrolling");assert.equal(await run('fixture.requests.at(-1).limit'),14);
    for(let batch=2;batch<=102;batch++){
      await run('document.querySelector("main").scrollTop=document.querySelector("main").scrollHeight');
      await until('Number(document.querySelector(".screen-virtual-grid")?.dataset.totalTitles)>='+(14+(batch-1)*7));if(batch===2){await new Promise(r=>setTimeout(r,150));assert.equal(await run('Number(document.querySelector(".screen-virtual-grid").dataset.totalTitles)'),21,"One bottom scroll adds exactly seven");
      if(process.env.VESTRA_SCREEN_LIVE_POSTERS)await until('Array.from(document.querySelectorAll(".screen-card img")).filter(image=>image.complete&&image.naturalWidth>0).length>=21');
      const profile=await run('new Promise(resolve=>{const el=document.querySelector("main");const count=fixture.commits;const render=fixture.renderMs;const max=Math.max(0,el.scrollHeight-el.clientHeight-200);let frame=0;let previous=performance.now();const times=[];function step(now){times.push(now-previous);previous=now;el.scrollTop=max*(1-Math.cos(frame/40*Math.PI*2))/2;if(++frame<40)requestAnimationFrame(step);else{times.sort((a,b)=>a-b);resolve({commits:fixture.commits-count,renderMs:Math.round(fixture.renderMs-render),p95Ms:Math.round(times[Math.floor(times.length*.95)]),titles:Number(document.querySelector(".screen-virtual-grid").dataset.totalTitles)});}}requestAnimationFrame(step);})');console.log('PROFILE 21-title scrolling '+JSON.stringify(profile));const posterStats=await run('(()=>{const images=Array.from(document.querySelectorAll(".screen-card img"));return {loaded:images.filter(image=>image.complete&&image.naturalWidth).length,maxWidth:Math.max(...images.map(image=>image.naturalWidth)),decodedMB:Math.round(images.reduce((sum,image)=>sum+image.naturalWidth*image.naturalHeight*4,0)/1048576)};})()');console.log('POSTERS '+JSON.stringify(posterStats));if(process.env.VESTRA_SCREEN_LIVE_POSTERS)assert.equal(posterStats.maxWidth<=480,true,"MovieBox posters must be resized before decoding");
      }
    }
    assert.equal(await run('document.querySelectorAll(".screen-card").length<100'),true,'Poster DOM must stay bounded');
    const before=await run('document.querySelector("main").scrollTop');
    await run('document.querySelector("main").scrollTop=0');await until('document.querySelector(".screen-card h2")?.textContent==="Stress title 1 0"');
    assert.equal(await run('document.querySelectorAll(".screen-card").length<100'),true);
    console.log('PASS 720+ titles, bounded poster DOM, nested scrolling and return to first row; deep scroll offset '+before);
    const imageAllocations=await run('fixture.imageCreates');
    const fetched=await run('fixture.requests.length');const titles=await run('Number(document.querySelector(".screen-virtual-grid").dataset.totalTitles)');
    await run('fixture.navigate("/series")');await until('fixture.requests.at(-1).kind==="tv"||document.querySelector("h1").textContent==="TV series"');await run('fixture.navigate("/films?category=popular")');await until('Number(document.querySelector(".screen-virtual-grid")?.dataset.totalTitles)==='+titles);assert.equal(await run('fixture.requests.filter(r=>r.kind==="movie").length'),await run('fixture.requests.slice(0,'+fetched+').filter(r=>r.kind==="movie").length'),"Returning to cached feed makes no movie requests");
    await until('document.querySelectorAll(".screen-card img").length>0');const newImages=await run('fixture.imageCreates')-imageAllocations;assert.equal(newImages<await run('document.querySelectorAll(".screen-card img").length'),true,"Returning rows reuse loaded poster nodes");console.log('PASS poster node reuse across navigation; newly allocated '+newImages);
    const beforeRefresh=await run('fixture.requests.length');await click('Refresh titles');await until('Number(document.querySelector(".screen-virtual-grid")?.dataset.totalTitles)===14');assert.equal(await run('fixture.requests.length'),beforeRefresh+1);assert.equal(await run('fixture.requests.at(-1).refresh'),true);
    console.log('PASS cached navigation makes zero movie requests; explicit refresh requests fresh metadata');
    win.setContentSize(375,900);await new Promise(r=>setTimeout(r,150));assert.equal(await run('document.querySelector("main").scrollWidth<=document.querySelector("main").clientWidth'),true);
    win.destroy();app.exit(0);
    }catch(error){console.error(error);win.destroy();app.exit(1);}});`,
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
      reject(Error("Screen UI fixture timed out"));
    }, 60000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (code !== 0) throw Error(`Screen UI fixture failed (${code})`);
} finally {
  await rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
}
