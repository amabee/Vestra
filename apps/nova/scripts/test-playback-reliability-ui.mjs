import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
const nova = resolve("apps/nova"),
  scratch = await mkdtemp(join(nova, "node_modules/.recovery-ui-"));
try {
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter,useLocation} from 'react-router';import {DEFAULT_SETTINGS} from '@vestra/types';import {PlayerOverlay} from './renderer/src/components/player/player-overlay';import {usePlayer} from './renderer/src/lib/player-store';fixture.defaults=structuredClone(DEFAULT_SETTINGS);fixture.player=usePlayer;function Location(){const location=useLocation();fixture.path=location.pathname+location.search;return null;}usePlayer.getState().open(fixture.item,fixture.queue,0,40);createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Location/><PlayerOverlay/></MemoryRouter></QueryClientProvider>);`,
      resolveDir: nova,
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    outfile: join(scratch, "fixture.js"),
    tsconfig: join(nova, "renderer/tsconfig.json"),
    plugins: [
      {
        name: "bridge",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/bridge$/ }, () => ({
            path: "bridge",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const bridge=window.fixture.bridge",
          }));
        },
      },
    ],
  });
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html><body><div id="root"></div><script>
window.fixture={opens:[],saves:[],defaults:null,item:{source:'anilist',kind:'anime',sourceId:'42',title:'A quiet journey',images:{},rating:{}},queue:[{kind:'stream',locator:'vestra-stream://fixture',progressId:'episode-7',episode:7,season:2}],state:{running:true,idle:true,paused:false,position:0,duration:0,volume:1,muted:false,speed:1,subtitleDelay:0,subtitleScale:1,ended:false,tracks:[],chapters:[],subtitleVisible:true,error:null}};
fixture.push=patch=>{Object.assign(fixture.state,patch);fixture.listener?.(structuredClone(fixture.state))};
fixture.bridge={settings:{get:async()=>structuredClone(fixture.defaults)},media:{skipTimes:async()=>[],streamQualities:async()=>[]},progress:{all:async()=>({}),save:async value=>{fixture.saves.push(value);return {percent:value.positionSeconds/value.durationSeconds,completed:false}}},history:{add:async()=>{}},watchlist:{list:async()=>[]},window:{isFullscreen:async()=>false,setFullscreen:async()=>{}},mpv:{status:async()=>({available:true}),setRect:async()=>{},onState:listener=>{fixture.listener=listener;return()=>{fixture.listener=null}},subscribe:async()=>structuredClone(fixture.state),open:async request=>{fixture.opens.push(request);fixture.push({idle:false,loading:false,position:request.startSeconds,duration:900,error:null})},close:async()=>{}},player:{setNowPlaying:async value=>{fixture.nowPlaying=value},onQuality:()=>()=>{},onCommand:listener=>{fixture.command=listener;return()=>{fixture.command=null}}}};
</script><script src="fixture.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    `
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});app.commandLine.appendSwitch('disable-gpu');app.whenReady().then(async()=>{let win;try{win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message)});await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});const run=s=>win.webContents.executeJavaScript(s),wait=async s=>{for(let n=0;n<160;n++){if(await run('Boolean('+s+')'))return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out '+s)};
await wait('fixture.opens.length===1 && fixture.nowPlaying?.loading===false');assert.equal(await run('fixture.opens[0].startSeconds'),40);
await run('fixture.push({position:125,idle:false,error:null})');await new Promise(r=>setTimeout(r,50));await run('fixture.push({position:0,idle:true,error:"Playback stopped: error"})');await wait('document.querySelector("[role=alert]")');await run('fixture.command("retry")');await wait('fixture.opens.length===2 && fixture.nowPlaying?.loading===false');assert.equal(await run('fixture.opens[1].startSeconds'),125);
await run('fixture.push({position:162,idle:false,error:null})');await new Promise(r=>setTimeout(r,50));await run('fixture.push({position:0,idle:true,error:"Playback stopped: error"})');await wait('document.querySelector("[role=alert]")');await run('[...document.querySelectorAll("button")].find(b=>b.textContent==="Choose another source").click()');await wait('fixture.path.includes("chooseSource=1")');assert.equal(await run('fixture.player.getState().item'),null);assert.equal(await run('new URLSearchParams(fixture.path.split("?")[1]).get("resumeEpisode")'),'7');assert.equal(await run('new URLSearchParams(fixture.path.split("?")[1]).get("resumeSeason")'),'2');assert.equal(await run('new URLSearchParams(fixture.path.split("?")[1]).get("resumeAt")'),'162');
console.log('PASS actual player retry preserves the last position and source recovery carries the same episode and season');win.destroy();app.exit(0);
}catch(error){console.error(error);win?.destroy();app.exit(1)}});
`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((accept, reject) => {
    const child = spawn(
      createRequire(import.meta.url)("electron"),
      [join(scratch, "runner.cjs")],
      { env, windowsHide: true, stdio: "inherit" },
    );
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Playback recovery UI timed out"));
    }, 30000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? accept()
        : reject(Error("Playback recovery UI failed " + code));
    });
  });
} finally {
  await rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
