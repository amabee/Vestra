import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(join(nova, "node_modules/.anime-ui-"));
try {
  await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
        import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
        import {MemoryRouter,Routes,Route,useLocation,useNavigate} from 'react-router';
        import {BrowseRoute} from './renderer/src/routes/browse';
        import {DetailRoute} from './renderer/src/routes/detail';
        import {usePlayer} from './renderer/src/lib/player-store';
        function Probe(){window.fixture.navigate=useNavigate();window.fixture.location=useLocation();window.fixture.player=usePlayer();return null;}
        createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/anime']}><Probe/><Routes><Route path='/anime' element={<BrowseRoute kind='anime' title='Anime' lead='Fixture'/>}/><Route path='/media/:source/:kind/:id' element={<DetailRoute/>}/></Routes></MemoryRouter></QueryClientProvider>);`,
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
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html><body><div id="root"></div><script>
    window.fixture={calls:[],fail:false};
    const item={source:'anilist',kind:'anime',sourceId:'123',title:'Catalogue Anime',originalTitle:'Original Anime',images:{},rating:{score:null},isSeries:true,genres:[],seasons:[],studios:[],cast:[],status:'released'};
    const queue=[1,2].map(n=>({kind:'stream',locator:'vestra-stream://fixture-'+n,mimeType:null,label:'Episode '+n,priority:80,episode:n}));
    window.fixtureBridge={
      anime:{sources:async()=>[{id:'ext-first',name:'First source'},{id:'ext-second',name:'Second source'}],search:async()=>[],episodes:async()=>({item,queue})},
      media:{trending:async()=>[{providerId:'anilist',providerName:'AniList',items:[item]}],details:async()=>item,resolvePlayback:async(ref,source)=>{fixture.calls.push({ref,source});if(fixture.fail)throw Error('Fixture source failure');return queue;}},
      library:{files:async()=>[],onChanged:()=>()=>{}},progress:{all:async()=>({})},bookmarks:{all:async()=>({})},watchlist:{list:async()=>[]},
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
        assert.equal(await run('window.fixture.calls[0].source'),'ext-second');
        assert.equal(await run('window.fixture.location.search'),'?source=ext-second');
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Play Episode 1").click()');
        await until('window.fixture.player.queue.length===2');
        assert.equal(await run('window.fixture.player.item.sourceId'),'123');
        console.log('PASS selected anime provider follows catalogue navigation and hands all episodes to the player');
        await run('window.fixture.navigate(-1)');
        await until('document.querySelector("select")?.value === "ext-second"');
        await run('window.fixture.navigate("/anime?source=ext-first")');
        await until('document.querySelector("select")?.value === "ext-first"');
        console.log('PASS Back and URL navigation update the same provider selection');
        await run('document.querySelector("button[aria-label=Play]").click()');
        await until('window.fixture.calls.length>=3 && window.fixture.location.pathname.includes("/media/") && document.getElementById("root").textContent.includes("Episode 1")');
        assert.equal(await run('window.fixture.calls[1].source'),'ext-first');
        assert.equal(await run('window.fixture.location.search'),'?source=ext-first');
        console.log('PASS catalogue Play actions retain the selected streaming provider');
        await run('window.fixture.fail=true;window.fixture.navigate("/media/anilist/anime/456?source=ext-first")');
        await until('document.getElementById("root").textContent.includes("Fixture source failure")');
        await run('window.fixture.fail=false;Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Retry episodes").click()');
        await until('document.getElementById("root").textContent.includes("Episode 1")');
        assert.equal(await run('window.fixture.calls.at(-1).source'),'ext-first');
        console.log('PASS direct anime links use their source and failed episode loading can be retried');
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
