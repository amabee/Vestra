import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(join(nova, "node_modules/.anime-ui-"));
try {
  await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider,useQueryClient} from '@tanstack/react-query';
        import {MemoryRouter,Routes,Route,useLocation,useNavigate} from 'react-router';
        import {BrowseRoute} from './renderer/src/routes/browse';
        import {DetailRoute} from './renderer/src/routes/detail'; import {ExtensionsRoute} from './renderer/src/routes/extensions';
        import {usePlayer} from './renderer/src/lib/player-store';
        function Probe(){window.fixture.cache=useQueryClient();window.fixture.navigate=useNavigate();window.fixture.location=useLocation();window.fixture.player=usePlayer();return null;}
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/anime']}><Probe/><Routes><Route path='/anime' element={<BrowseRoute kind='anime' title='Anime' lead='Fixture'/>}/><Route path='/extensions' element={<ExtensionsRoute/>}/><Route path='/media/:source/:kind/:id' element={<DetailRoute/>}/></Routes></MemoryRouter></QueryClientProvider>);`,
      resolveDir: nova,
      loader: "tsx",
    },
    tsconfig: join(nova, "renderer/tsconfig.json"),
    bundle: true,
    format: "iife",
    outfile: join(scratch, "fixture.js"),
    plugins: [
      {
        name: "fixture-bridge",
        setup(build) {
          build.onResolve({ filter: /^@\/lib\/bridge$/ }, () => ({
            path: "bridge",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const bridge = window.fixtureBridge;",
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
    window.fixture={calls:[],fail:false, noMatch:false, saved:{}, marks:{}};
    const item={source:'anilist',kind:'anime',sourceId:'123',title:'Catalogue Anime',originalTitle:'Original Anime',images:{},rating:{score:null},isSeries:true,genres:[],seasons:[],studios:[],cast:[],status:'released'};
    const queue=[1,2].map(n=>({kind:'stream',locator:'vestra-stream://fixture-'+n,mimeType:null,label:'Episode '+n,priority:80,episode:n}));
    window.fixture.managed=[{id:'existing-provider',name:'Existing Anime Extension',type:'onlinestream-provider',hosts:['source.example'],preferences:{},enabled:true,status:'ready',servers:[],versions:[],sourceHash:'a'.repeat(64)}];
    window.fixtureBridge={
      sources:{applyRemote:async(token,hosts)=>{fixture.applied={token,hosts};fixture.managed.push({...fixture.managed[0],id:"other-provider",name:"Manifest Only Provider",hosts});},list:async()=>fixture.managed,update:async(id,options)=>{fixture.managed=fixture.managed.map(row=>row.id===id?{...row,...options,status:options.enabled?'ready':'disabled'}:row);},pick:async()=>null},
      extensions:{installed:async()=>[],list:async()=>[],registries:async()=>['https://registry.example/index.json'],browse:async()=>({entries:[{id:'other-provider',name:'Manifest Only Provider',version:'1.0.0',type:'onlinestream-provider',manifestURI:'https://registry.example/other/manifest.json',payloadURI:'',registryUrl:'https://registry.example/index.json'}],errors:[],rejected:0}),prepare:async candidate=>{fixture.prepared=candidate;return {kind:'provider',plan:{token:'test-review',id:'other-provider',name:'Manifest Only Provider',type:'onlinestream-provider',version:'1.0.0',manifestUrl:candidate.manifestURI,payloadUrl:'https://cdn.example/provider.ts',sha256:'a'.repeat(64),checksumVerified:false,hosts:['other.example'],addedHosts:['other.example'],inferredHosts:true,updating:false,changed:true}};}},
      anime:{resolve:async(source,ref)=>{fixture.calls.push({ref,source});if(fixture.fail)throw Error('Fixture source failure');return fixture.noMatch?null:{item,providerTitle:'Provider Anime',queue:fixture.empty?[]:queue.map(entry=>({...entry,progressId:source+'-'+entry.episode,locator:entry.locator+'-'+source}))};},sources:async()=>fixture.available??[{id:'ext-first',name:'First source'},{id:'ext-second',name:'Second source'}],search:async()=>[],episodes:async()=>({item,queue})},
      media:{trending:async()=>[{providerId:'anilist',providerName:'AniList',items:[item]}],details:async()=>item,resolvePlayback:async(ref,source)=>{fixture.calls.push({ref,source});if(fixture.fail)throw Error('Fixture source failure');return queue;}},
      library:{files:async()=>[],onChanged:()=>()=>{}},progress:{all:async()=>fixture.saved,save:async request=>{fixture.saved['anilist:anime:123#'+request.episodeId]={...request,completed:request.positionSeconds>0,percent:request.positionSeconds>0?1:0};}},bookmarks:{all:async()=>fixture.marks,toggle:async request=>{const key='anilist:anime:123#'+request.episodeId;if(fixture.marks[key])delete fixture.marks[key];else fixture.marks[key]=Date.now();}},watchlist:{list:async()=>[]},
    };
    </script><script src="fixture.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    `
    const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');
    app.commandLine.appendSwitch('disable-gpu');
    app.whenReady().then(async()=>{
      const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,contextIsolation:false,nodeIntegration:false}});
      win.webContents.on("console-message",event=>{if(event.level==="error") console.error(event.message);});
      const run=code=>win.webContents.executeJavaScript(code);
      const until=async(code)=>{for(let i=0;i<150;i++){if(await run("Boolean("+code+")"))return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out: '+code);};
      try{
        await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});
        await until('document.querySelector("select")?.value === "ext-first"');
        await until('window.fixture.location.search.includes("ext-first")');
        await run('(()=>{const s=document.querySelector("select");s.value="ext-second";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
        await until('window.fixture.location.search.includes("ext-second")');
        await until('document.querySelector("[role=button]")');
        await run('document.querySelector("[role=button]").click()');
        await until('window.fixture.calls.length===1 && document.getElementById("root").textContent.includes("Episode 1")');
        if(process.env.VESTRA_ANIME_SCREENSHOT){
          for(const width of [1440,375]){win.setContentSize(width,900);await new Promise(r=>setTimeout(r,180));require('node:fs').mkdirSync(require('node:path').dirname(process.env.VESTRA_ANIME_SCREENSHOT),{recursive:true});require('node:fs').writeFileSync(process.env.VESTRA_ANIME_SCREENSHOT+'-'+width+'.png',(await win.webContents.capturePage()).toPNG());}
        }
        assert.equal(await run('window.fixture.calls[0].source'),'ext-second');
        assert.equal(await run('window.fixture.location.search'),'?source=ext-second');
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim().toLowerCase()==="play episode 1").click()');
        await until('window.fixture.player.queue.length===2');
        assert.equal(await run('window.fixture.player.item.sourceId'),'123');
        console.log('PASS selected anime provider follows catalogue navigation and hands all episodes to the player');
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Mark episode 1 watched").click()');
        await until('document.getElementById("root").textContent.includes("1 watched")');
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Bookmark episode 2").click()');
        await until('Array.from(document.querySelectorAll("button")).some(b=>b.getAttribute("aria-label")==="Remove bookmark for episode 2")');
        console.log('PASS per-episode watched state and bookmarks use stable streaming identities');
        await run('(()=>{const s=Array.from(document.querySelectorAll("select")).find(e=>e.getAttribute("aria-label")==="Streaming extension");s.value="ext-first";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
        await until('window.fixture.calls.at(-1).source==="ext-first" && Array.from(document.querySelectorAll("button")).find(e=>e.getAttribute("aria-label")==="Mark episode 1 watched")');
        await run('(()=>{const s=Array.from(document.querySelectorAll("select")).find(e=>e.getAttribute("aria-label")==="Streaming extension");s.value="ext-second";s.dispatchEvent(new Event("change",{bubbles:true}));})()');
        await until('Array.from(document.querySelectorAll("button")).find(e=>e.getAttribute("aria-label")==="Mark episode 1 unwatched")');
        console.log('PASS switching extensions in details reloads matching episodes and isolates watch status');
        await run('window.fixture.navigate(-1)');
        await until('document.querySelector("select")?.value === "ext-second"');
        await run('window.fixture.navigate("/anime?source=ext-first")');
        await until('document.querySelector("select")?.value === "ext-first"');
        console.log('PASS Back and URL navigation update the same provider selection');
        const quickStart=await run("window.fixture.calls.length");
        await run('document.querySelector("button[aria-label=Play]").click()');
        await until('window.fixture.calls.length>'+quickStart+' && window.fixture.location.pathname.includes("/media/") && document.getElementById("root").textContent.includes("Episode 1")');
        assert.equal(await run('window.fixture.calls['+quickStart+'].source'),'ext-first');
        assert.equal(await run('window.fixture.location.search'),'?source=ext-first');
        console.log('PASS catalogue Play actions retain the selected streaming provider');
        await run('window.fixture.fail=true;window.fixture.navigate("/media/anilist/anime/456?source=ext-first")');
        await until('document.getElementById("root").textContent.includes("Fixture source failure")');
        await run('window.fixture.fail=false;Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Retry episodes").click()');
        await until('document.getElementById("root").textContent.includes("Episode 1")');
        assert.equal(await run('window.fixture.calls.at(-1).source'),'ext-first');
        console.log('PASS direct anime links use their source and failed episode loading can be retried');
        await run('window.fixture.noMatch=true;window.fixture.navigate("/media/anilist/anime/789?source=ext-first")');
        await until('document.getElementById("root").textContent.includes("No matching title")');
        await run('window.fixture.noMatch=false;window.fixture.empty=true;window.fixture.navigate("/media/anilist/anime/790?source=ext-first")');
        await until('document.getElementById("root").textContent.includes("No episodes published")');
        await run('window.fixture.available=[{id:"ext-second",name:"Second source"}];window.fixture.cache.invalidateQueries({queryKey:["anime-sources"]})');
        await until('document.getElementById("root").textContent.includes("disabled or removed")');
        assert.equal(await run('window.fixture.location.search'),'?source=ext-first');
        await run('window.fixture.available=[];window.fixture.cache.invalidateQueries({queryKey:["anime-sources"]})');
        await until('document.getElementById("root").textContent.includes("No anime extensions enabled")');
        console.log('PASS unmatched titles, empty episode lists and disabled or missing extensions have distinct recovery states');
        await run('window.fixture.navigate("/extensions")');
        await until('document.getElementById("root").textContent.includes("Existing Anime Extension")');
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Disable").click()');
        await until('document.getElementById("root").textContent.includes("Disabled")');
        assert.equal(await run('window.fixture.managed[0].enabled'),false);
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Enable").click()');
        await until('document.getElementById("root").textContent.includes("Loaded")');
        assert.equal(await run('window.fixture.managed[0].id'),'existing-provider');
        assert.equal(await run('document.querySelectorAll("h1").length'),1);
        console.log('PASS Extensions owns existing provider enablement, configuration and import controls');
        await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Review")');
        assert.equal(await run('document.getElementById("root").textContent.includes("No code listed")'),false);
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Review").click()');
        await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Install extension")');
        assert.equal(await run('document.activeElement.getAttribute("aria-label")'),'Review extension installation');
        assert.equal(await run('window.fixture.prepared.payloadURI'),'');
        assert.equal(await run('window.fixture.applied===undefined'),true);
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Install extension").click()');
        await until('window.fixture.applied && Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Installed")');
        assert.equal(await run('window.fixture.applied.hosts[0]'),'other.example');
        console.log('PASS manifest-only Available listings can be reviewed and installed without a listing-level code URL');
        win.destroy();app.exit(0);
      }catch(error){console.error(error);win.destroy();app.exit(1);}
    });
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
      reject(new Error("Anime UI fixture timed out"));
    }, 30000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (code !== 0) throw new Error(`Anime UI fixture failed (${code})`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
