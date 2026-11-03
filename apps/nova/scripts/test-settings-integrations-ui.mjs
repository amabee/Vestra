import { build } from "esbuild";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(nova, "node_modules/.integrations-ui-"));
try {
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router';import {DEFAULT_SETTINGS} from '@vestra/types';import {MangaDetailsPage} from './renderer/src/components/manga/manga-details';import {ReaderImages} from './renderer/src/lib/reader-images';fixture.settings=structuredClone(DEFAULT_SETTINGS);fixture.settings.privacy.mangaUnreadCount=true;fixture.client=new QueryClient({defaultOptions:{queries:{retry:false}}});fixture.patch=value=>{Object.assign(fixture.settings.appearance,value);fixture.client.setQueryData(['settings'],structuredClone(fixture.settings))};createRoot(document.getElementById('root')).render(<QueryClientProvider client={fixture.client}><MemoryRouter><MangaDetailsPage catalogueId={42} book={{id:'book',title:'Manga fixture',cover:'cover'}} provider='source' sourceName='Reading source' images={new ReaderImages(fixtureBridge.manga.image)} saved={false} saving={false} resolving={false} onRead={()=>fixture.started=true} onBookmark={()=>fixture.bookmarked=true} onBack={()=>{}} onSearch={()=>{}} onRetryResolution={()=>{}}/></MemoryRouter></QueryClientProvider>);`,
      resolveDir: nova,
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    tsconfig: join(nova, "renderer/tsconfig.json"),
    outfile: join(scratch, "fixture.js"),
    plugins: [
      {
        name: "bridge",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/bridge$/ }, () => ({
            path: "bridge",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const bridge=window.fixtureBridge;",
          }));
        },
      },
    ],
  });
  const theme = (await readdir(join(nova, "dist-renderer/assets"))).find(
    (f) => f.startsWith("theme-") && f.endsWith(".css"),
  );
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html data-theme="vestra"><head><link rel="stylesheet" href="${pathToFileURL(join(nova, "dist-renderer/assets", theme))}"><link rel="stylesheet" href="fixture.css"></head><body style="height:auto;overflow:auto"><main style="padding:24px"><div id="root"></div></main><script>
  const picture='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=';
  window.fixture={settings:null,unread:3,started:false,bookmarked:false};
  fixture.info={id:42,title:'The stories we keep',genres:['Adventure','Drama'],origin:'JP',status:'RELEASING',score:84,description:'A quiet story of distant places and the people who remember them.',chapters:3,volumes:1,year:2026,titles:['The stories we keep'],cover:'cover',banner:'banner'};
  window.fixtureBridge={settings:{get:async()=>structuredClone(fixture.settings)},manga:{details:async()=>structuredClone(fixture.info),chapters:async()=>[{id:'one',title:'Arrival',chapter:'1',index:0},{id:'two',title:'A place to stay',chapter:'2',index:1},{id:'three',title:'Tomorrow',chapter:'3',index:2}],progress:async()=>null,cover:async()=>({id:'book',title:'The stories we keep',cover:'cover'}),image:async()=>picture,unread:async()=>({total:3,unread:fixture.unread,completed:3-fixture.unread,updatedAt:Date.now(),historyKnown:true}),markChapters:async(p,b,read)=>{fixture.unread=read?0:3;return {total:3,unread:fixture.unread,completed:3-fixture.unread,updatedAt:Date.now(),historyKnown:true}}}};
  </script><script src="fixture.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    String.raw`
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});app.commandLine.appendSwitch('disable-gpu');app.whenReady().then(async()=>{let win;try{
win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});const run=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(e){console.error('Failed UI script:',s);throw e}};const wait=async s=>{const end=Date.now()+7000;while(Date.now()<end){if(await run('Boolean('+s+')'))return;await new Promise(r=>setTimeout(r,20));}throw Error('UI did not reach '+s)};
await wait('document.querySelector(".manga-info__banner img") && document.querySelector(".media-count-badge")?.getAttribute("aria-label")==="3 unread chapters"');
for(const mode of ['default','blur-available','dim-unavailable','hide-unavailable','dim','blur','hide']){await run('fixture.patch({mediaBannerAppearance:'+JSON.stringify(mode)+'})');await wait(mode==='hide'?'!document.querySelector(".manga-info__banner")':'document.querySelector(".manga-info__banner")');if(mode==='blur'||mode==='blur-available')await wait('document.querySelector(".manga-info__banner").classList.contains("is-blurred")');if(mode==='dim')await wait('document.querySelector(".manga-info__banner").classList.contains("is-dimmed")');}
await run('fixture.patch({mediaBannerAppearance:"blur",glassEffects:false})');await wait('document.querySelector(".manga-info__banner") && !document.querySelector(".manga-info__banner").classList.contains("is-blurred")');
await run('fixture.patch({mediaBannerAppearance:"default",glassEffects:true,bannerOpacity:.35,bannerPosition:"bottom",mediaBannerSize:"small"})');await wait('document.querySelector(".manga-info__banner").dataset.size==="small"');assert.equal(await run('document.querySelector(".manga-info__banner img").style.opacity'),'0.35');assert.equal(await run('document.querySelector(".manga-info__banner img").style.objectPosition'),'center bottom');
await run('fixture.client.setQueryData(["manga-info",42],{...fixture.info,banner:undefined});fixture.patch({mediaBannerAppearance:"hide-unavailable"})');await wait('!document.querySelector(".manga-info__banner")');await run('fixture.patch({mediaBannerAppearance:"blur-available"})');await wait('document.querySelector(".manga-info__banner")?.dataset.hasBackdrop==="false"');assert.equal(await run('document.querySelector(".manga-info__banner").classList.contains("is-blurred")'),false);
await run('[...document.querySelectorAll("button")].find(b=>b.textContent==="Mark all chapters read").click()');await wait('document.querySelector(".media-count-badge")?.getAttribute("aria-label")==="0 unread chapters"');await run('[...document.querySelectorAll("button")].find(b=>b.textContent==="Mark all chapters unread").click()');await wait('document.querySelector(".media-count-badge")?.getAttribute("aria-label")==="3 unread chapters"');await run('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Start reading")).click()');await wait('fixture.started');
await run('fixture.patch({mediaBannerAppearance:"default",mediaBannerSize:"medium",bannerOpacity:.65});fixture.client.setQueryData(["manga-info",42],fixture.info)');await wait('document.querySelector(".manga-info__banner")?.dataset.hasBackdrop==="true"');
for(const width of [1280,700,420]){win.setContentSize(width,900);await new Promise(r=>setTimeout(r,120));assert.equal(await run('document.documentElement.scrollWidth<=window.innerWidth'),true,'Manga details overflow '+width);if(process.env.VESTRA_INTEGRATIONS_SCREENSHOT){fs.mkdirSync(path.dirname(process.env.VESTRA_INTEGRATIONS_SCREENSHOT),{recursive:true});fs.writeFileSync(process.env.VESTRA_INTEGRATIONS_SCREENSHOT+'-'+width+'.png',(await win.webContents.capturePage()).toPNG());}}
console.log('PASS manga banner modes/fallback/size/opacity/position/blur dependency, exact unread reconciliation, preserved reading action and responsive layouts');win.destroy();app.exit(0);
}catch(error){console.error(error);win?.destroy();app.exit(1)}});`,
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
      reject(Error("Integrations UI timed out"));
    }, 60000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? accept() : reject(Error("Integrations UI failed " + code));
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
