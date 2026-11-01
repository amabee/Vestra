import { build } from "esbuild";
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
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider,useQueryClient} from '@tanstack/react-query';import {MemoryRouter,Routes,Route,useNavigate,useLocation} from 'react-router';import {BrowseRoute} from './renderer/src/routes/browse';import {DetailRoute} from './renderer/src/routes/detail';import {usePlayer} from './renderer/src/lib/player-store';
    function Probe(){fixture.navigate=useNavigate();fixture.location=useLocation();fixture.cache=useQueryClient();fixture.player=usePlayer();return null;}
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,staleTime:0}}})}><MemoryRouter initialEntries={['/films']}><Probe/><Routes><Route path='/films' element={<BrowseRoute kind='movie' title='Films' lead='Catalogue'/>}/><Route path='/series' element={<BrowseRoute kind='tv' title='Series' lead='Catalogue'/>}/><Route path='/media/:source/:kind/:id' element={<DetailRoute/>}/></Routes></MemoryRouter></QueryClientProvider>);`,
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
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html lang="en" data-theme="vestra"><head><meta charset="utf-8"><link rel="stylesheet" href="${pathToFileURL(join(nova, "dist-renderer/assets", theme)).href}"><link rel="stylesheet" href="${pathToFileURL(join(scratch, "fixture.css")).href}"></head><body><div id="root"></div><script>
    const item=(kind='tv')=>({source:'ext-screen',sourceId:kind==='movie'?'film':'show',kind,title:kind==='movie'?'Example Film':'Example Series',images:{poster:${JSON.stringify(poster)},backdrop:null},rating:{score:null},year:2025,genres:[],isSeries:kind==='tv',seasons:[],studios:[],cast:[],related:[],streaming:[],countries:[],languages:[]});
    const queue=[{kind:'stream',locator:'vestra-stream://first',progressId:'stable-s1e1',episode:1,season:1,label:'Pilot',priority:80},{kind:'stream',locator:'vestra-stream://second',progressId:'stable-s2e1',episode:1,season:2,label:'Return',priority:80}];
    window.fixture={item,requests:[],sources:[{id:'ext-screen',name:'Screen fixture',categories:['popular','latest']},{id:'ext-other',name:'Other fixture',categories:[]}],progress:{'ext-screen:tv:show#stable-s2e1':{percent:.3,positionSeconds:30,durationSeconds:100,completed:false,updatedAt:2}},bookmarks:{},saves:[],bookmarkWrites:[],watchlist:[]};
    window.fixtureBridge={screen:{sources:async()=>fixture.sources,browse:async(request)=>{fixture.requests.push(request);if(fixture.fail)throw Error('Source offline');return {items:fixture.empty?[]:[item(request.kind)],hasMore:request.page===1};}},media:{details:async ref=>item(ref.kind),resolvePlayback:async()=>queue,trending:async()=>[]},library:{files:async()=>[],onChanged:()=>()=>{}},watchlist:{list:async()=>structuredClone(fixture.watchlist),add:async(item,status)=>{fixture.watchlist.push({ref:item,snapshot:item,status});return fixture.watchlist;}},progress:{all:async()=>structuredClone(fixture.progress),save:async(input)=>{fixture.saves.push(input);fixture.progress[input.ref.source+':'+input.ref.kind+':'+input.ref.sourceId+'#'+input.episodeId]={...input,percent:input.positionSeconds/input.durationSeconds,completed:input.positionSeconds>=input.durationSeconds};return fixture.progress[input.ref.source+':'+input.ref.kind+':'+input.ref.sourceId+'#'+input.episodeId];}},bookmarks:{all:async()=>structuredClone(fixture.bookmarks),toggle:async(input)=>{fixture.bookmarkWrites.push(input);const key=input.ref.source+':'+input.ref.kind+':'+input.ref.sourceId+'#'+input.episodeId;fixture.bookmarks[key]={ref:input.ref,episodeId:input.episodeId};return fixture.bookmarks;}},history:{list:async()=>[]}};
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
    await click('Next');await until('fixture.requests.at(-1).page===2');await click('Previous');await until('document.querySelector(".screen-pagination span").textContent==="Page 1"');
    await run('(()=>{const input=document.querySelector(".screen-search input");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"Example");input.dispatchEvent(new Event("input",{bubbles:true}));})()');await click('Search');await until('fixture.requests.at(-1).query==="Example"');assert.equal(await run('fixture.location.search.includes("q=Example")'),true);
    await run('fixture.navigate("/series")');await until('fixture.requests.at(-1).kind==="tv" && document.querySelector(".screen-card h2")?.textContent==="Example Series"');
    for(const width of [1440,375]){win.setContentSize(width,900);await new Promise(r=>setTimeout(r,100));assert.equal(await run('document.documentElement.scrollWidth<=window.innerWidth'),true,'Browse overflow '+width);if(process.env.VESTRA_SCREEN_SCREENSHOTS){const fs=require('node:fs');fs.mkdirSync(process.env.VESTRA_SCREEN_SCREENSHOTS,{recursive:true});fs.writeFileSync(require('node:path').join(process.env.VESTRA_SCREEN_SCREENSHOTS,'series-'+width+'.png'),(await win.webContents.capturePage()).toPNG());}}
    console.log('PASS movie/TV source browsing, search, pagination and responsive poster grids');
    await run('document.querySelector(".screen-card").click()');await until('document.querySelectorAll("article").length===2');await until('Array.from(document.querySelectorAll("button")).some(el=>el.getAttribute("aria-label")==="Resume Return")');
    await run('Array.from(document.querySelectorAll("button")).find(el=>el.getAttribute("aria-label")==="Resume Return").click()');await until('fixture.player.item');assert.equal(await run('fixture.player.index'),1);assert.equal(await run('fixture.player.startAt'),30);
    await run('(()=>{const el=Array.from(document.querySelectorAll("select")).find(el=>el.getAttribute("aria-label")==="Episode season");el.value="2";el.dispatchEvent(new Event("change",{bubbles:true}));})()');await until('document.querySelectorAll("article").length===1');
    await run('Array.from(document.querySelectorAll("button")).find(el=>el.getAttribute("aria-label")==="Bookmark Return").click()');await until('fixture.bookmarkWrites.length===1');assert.equal(await run('fixture.bookmarkWrites[0].episodeId'),'stable-s2e1');
    await run('Array.from(document.querySelectorAll("button")).find(el=>el.getAttribute("aria-label")==="Mark Return watched").click()');await until('fixture.saves.length===1');assert.equal(await run('fixture.saves[0].episodeId'),'stable-s2e1');
    await click('Plan to watch');await until('fixture.watchlist.length===1');await until('document.body.textContent.includes("Saved to your list")');assert.equal(await run('fixture.watchlist[0].ref.kind'),'tv');
    assert.equal(await run('document.documentElement.scrollWidth<=window.innerWidth'),true,'Details overflow mobile: '+JSON.stringify(await run('({width:innerWidth,scroll:document.documentElement.scrollWidth,x:scrollX,body:document.body.scrollWidth})'))+JSON.stringify(await run('Array.from(document.querySelectorAll("#root *")).filter(el=>el.getBoundingClientRect().right>window.innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,text:el.textContent.slice(0,60)})).slice(0,8)')));
    if(process.env.VESTRA_SCREEN_SCREENSHOTS)require('node:fs').writeFileSync(require('node:path').join(process.env.VESTRA_SCREEN_SCREENSHOTS,'details-375.png'),(await win.webContents.capturePage()).toPNG());
    console.log('PASS season selection, independent episode resume, bookmarks, watched state and list saving');
    await run('fixture.navigate("/films?source=ext-missing")');await until('document.body.textContent.includes("This extension is unavailable")');
    await run('fixture.sources=[];fixture.cache.invalidateQueries({queryKey:["screen-sources"]})');await until('document.body.textContent.includes("Bring your own movie source")');
    await run('fixture.sources=[{id:"ext-screen",name:"Screen fixture",categories:["popular"]}];fixture.fail=true;fixture.navigate("/films?source=ext-screen&q=offline");fixture.cache.invalidateQueries({queryKey:["screen-sources"]})');await until('document.body.textContent.includes("Source offline")');await run('fixture.fail=false');await click('Retry');await until('document.querySelectorAll(".screen-card").length===1');
    console.log('PASS missing/disabled source, empty installation state and retry after source failure');win.destroy();app.exit(0);
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
  await rm(scratch, { recursive: true, force: true });
}
