import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(nova, "node_modules/.settings-ui-"));
try {
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter,Routes,Route} from 'react-router';import {DEFAULT_SETTINGS} from '@vestra/types';import {SettingsRoute} from './renderer/src/routes/system';import {DownloadsRoute} from './renderer/src/routes/downloads';import {AppearanceController} from './renderer/src/components/chrome/appearance';fixture.settings=structuredClone(DEFAULT_SETTINGS);window.fixtureRoot=createRoot(document.getElementById('root'));fixtureRoot.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/settings']}><AppearanceController/><Routes><Route path="/settings" element={<SettingsRoute/>}/><Route path="/downloads" element={<DownloadsRoute/>}/></Routes></MemoryRouter></QueryClientProvider>);`,
      resolveDir: nova,
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    tsconfig: join(nova, "renderer/tsconfig.json"),
    loader: { ".woff": "file", ".woff2": "file", ".png": "dataurl" },
    outfile: join(scratch, "ui.js"),
    plugins: [
      {
        name: "bridge-fixture",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/bridge$/ }, () => ({
            path: "bridge",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents: "export const bridge=window.fixtureBridge;",
          }));
        },
      },
    ],
  });
  // Build the app stylesheet through Vite rather than treating Tailwind directives as ordinary CSS.
  const { readdir } = await import("node:fs/promises");
  const theme = (await readdir(join(nova, "dist-renderer/assets"))).find(
    (name) => name.startsWith("theme-") && name.endsWith(".css"),
  );
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html data-theme="vestra"><head><link rel="stylesheet" href="${pathToFileURL(join(nova, "dist-renderer/assets", theme)).href}"><link rel="stylesheet" href="${pathToFileURL(join(nova, "renderer/src/routes/settings.css")).href}"></head><body style="height:auto;overflow:auto"><div id="root"></div><script>
 window.fixture={settings:null,listeners:new Set(),patches:[],reject:false,account:{connected:false,user:null,encryptionAvailable:true,needsReconnect:false,loadError:false,backingUp:false,lastBackupAt:null,lastBackupError:null,nextBackupAttemptAt:null,backupCount:0}};
 window.fixtureBridge={anilistAccount:{status:async()=>structuredClone(fixture.account),authorize:async id=>{fixture.authorized=id},connect:async token=>{fixture.submittedToken=token;fixture.account={...fixture.account,connected:true,user:{id:7,name:'Account fixture',avatar:null,url:'https://anilist.co/user/7'}};return fixture.account},disconnect:async()=>{fixture.account={...fixture.account,connected:false,user:null,backupCount:0};return fixture.account},backup:async()=>{fixture.account={...fixture.account,lastBackupAt:Date.now(),backupCount:1};return fixture.account},exportLatest:async()=>true},extensions:{installed:async()=>[{id:'fixture',version:'1.0.0',registryUrl:'registry-fixture'}],browse:async()=>({entries:[{id:'fixture',version:'9.0.0',registryUrl:'other-registry'},{id:'fixture',version:'1.1.0',registryUrl:'registry-fixture'}],errors:[]})},anime:{sources:async()=>[{id:"fixture-source",name:"Fixture source"}]},settings:{folderStatus:async()=>[],get:async()=>structuredClone(fixture.settings),onChanged:fn=>{fixture.listeners.add(fn);return()=>fixture.listeners.delete(fn);},patch:async patch=>{if(fixture.reject)throw Error('disk failure');fixture.patches.push(patch);for(const [key,value] of Object.entries(patch))fixture.settings[key]={...fixture.settings[key],...value};for(const fn of fixture.listeners)fn(structuredClone(fixture.settings));return structuredClone(fixture.settings);}},app:{diagnostics:async()=>({providers:[],counts:{localFiles:2},dataDir:'fixture',extensions:[]}),sourceHealth:async()=>[{id:'ext-fixture',name:'Fixture source',enabled:true,loaded:true,kind:'native',observation:{state:'failed',at:new Date().toISOString(),durationMs:10,code:'timeout'}}],playbackDiagnostics:async()=>[],copyPlaybackDiagnostics:async()=>{}},torrents:{configuration:async()=>({configured:false,saved:false,encryptionAvailable:true,url:'http://localhost:8080',username:'',source:'none'}),test:async()=>({connected:true,version:'v5',error:null}),save:async()=>{},list:async()=>[{hash:'a'.repeat(40),name:'Fixture download',state:'downloading',progress:.5,sizeBytes:100,downloadedBytes:50,downloadSpeed:10,uploadSpeed:0}],pause:async hash=>{fixture.paused=hash},resume:async()=>{},add:async urls=>{fixture.added=urls}},updates:{state:async()=>({phase:'disabled',currentVersion:'0.1.2',message:'Installed builds only'}),onChanged:()=>()=>{}},library:{folders:async()=>[]}};
 </script><script src="ui.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    String.raw`const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});app.commandLine.appendSwitch('disable-gpu');app.whenReady().then(async()=>{let win;try{
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});win.webContents.on("console-message", (_e,details)=>{if(details.level==="error")console.error(details.message)});await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});
 const run=async s=>{try{return await win.webContents.executeJavaScript(s);}catch(e){console.error("Failed script:",s);throw e;}};const wait=async s=>{const end=Date.now()+5000;while(Date.now()<end){if(await run("Boolean("+s+")"))return;await new Promise(r=>setTimeout(r,20));}throw Error('UI did not reach '+s);};
 const section=async id=>{await run("[...document.querySelectorAll('[aria-label=\"Settings sections\"] button')].find(b=>b.textContent.startsWith("+JSON.stringify(id)+")).click()");};
 await wait("document.querySelector('[aria-label=\"Interface preview\"]')");assert.equal(await run("document.documentElement.dataset.colorMode"),'dark');
 await run("[...document.querySelectorAll('[aria-label=Theme] button')].find(b=>b.textContent==='Light').click()");await wait("document.documentElement.dataset.colorMode==='light'");
 await run("document.querySelector('[aria-label=\"Show navigation labels\"]').click()");await wait("fixture.settings.appearance.sidebarLabels===true");assert.equal(await run('fixture.settings.appearance.theme'),'light');
 await run("var select=document.querySelector('[aria-label=\"Text size\"]');select.value='large';select.dispatchEvent(new Event('change',{bubbles:true}))");await wait("document.documentElement.style.fontSize==='18px'");
 await section('Application');await wait("document.querySelector('[aria-label=\"Start page\"]')");await run("var select=document.querySelector('[aria-label=\"Start page\"]');select.value='/manga';select.dispatchEvent(new Event('change',{bubbles:true}))");await wait("fixture.settings.app.startupPage==='/manga'");
 await run("fixture.reject=true;document.querySelector('[aria-label=\"Show status bar\"]').click()");await wait("document.querySelector('[role=alert]')?.textContent.includes('could not be saved')");assert.equal(await run('fixture.settings.app.showStatusBar'),true);await run('fixture.reject=false');

 await wait("!document.querySelector('fieldset').disabled");
 await run("var select=document.querySelector('[aria-label=\"Default episode source\"]');select.value='fixture-source';select.dispatchEvent(new Event('change',{bubbles:true}))");await wait("fixture.settings.playback.defaultEpisodeSource==='fixture-source'");
 assert.equal(await run("document.querySelector('[aria-label=\"Blur adult content\"]').disabled"),true);
 await run("document.querySelector('[aria-label=\"Enable adult content\"]').click()");await wait("!document.querySelector('[aria-label=\"Blur adult content\"]').disabled");
 await run("document.querySelector('[aria-label=\"Blur adult content\"]').click()");await wait("fixture.settings.privacy.blurAdultContent===false");
 await run("document.querySelector('[aria-label=\"Enable adult content\"]').click()");await wait("document.querySelector('[aria-label=\"Blur adult content\"]').disabled");assert.equal(await run('fixture.settings.privacy.blurAdultContent'),false);
 await run("document.querySelector('[aria-label=\"Enable watch history\"]').click()");await wait("fixture.settings.privacy.trackHistory===false");assert.equal(await run('fixture.settings.playback.autoUpdateProgress'),true);
 const search=async text=>{await run("var input=document.querySelector('[aria-label=\"Search settings\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,"+JSON.stringify(text)+");input.dispatchEvent(new Event('input',{bubbles:true}))");};
 await search('Hardware decoding');await wait("document.querySelector('[aria-label=\"Hardware decoding\"]')");assert.equal(await run("document.querySelector('[aria-label=\"Start page\"]')===null"),true);
 await search('scanner');await wait("document.querySelector('[aria-label=\"Scanner configuration JSON\"]')");
 await run("var input=document.querySelector('[aria-label=\"Scanner configuration JSON\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'{');input.dispatchEvent(new Event('input',{bubbles:true}))");await wait("document.querySelector('[aria-label=\"Scanner configuration JSON\"]').getAttribute('aria-invalid')==='true'");assert.equal(await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Apply scanner configuration').disabled"),true);
 await run("var input=document.querySelector('[aria-label=\"Scanner configuration JSON\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,JSON.stringify({maxDepth:3,maxFiles:100,excludedDirectories:[]}));input.dispatchEvent(new Event('input',{bubbles:true}))");await wait("document.querySelector('[aria-label=\"Scanner configuration JSON\"]').getAttribute('aria-invalid')==='false'");await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Apply scanner configuration').click()");await wait('fixture.settings.library.scanner.maxDepth===3');
 await search('Background color');await wait("document.querySelector('[aria-label=\"Background color hex\"]')");
 await run("var input=document.querySelector('[aria-label=\"Background color hex\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#ddeeff');input.dispatchEvent(new Event('input',{bubbles:true}))");await wait("document.documentElement.style.getPropertyValue('--color-base-100')==='#ddeeff'");assert.equal(await run("document.documentElement.style.getPropertyValue('--color-base-content')"),'#000000');
 await search('');
 await section('Application');await wait("document.querySelector('[aria-label=\"AniList access token\"]')");
 await run("var input=document.querySelector('[aria-label=\"AniList access token\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'fixture.access.token.value');input.dispatchEvent(new Event('input',{bubbles:true}))");
 await wait("![...document.querySelectorAll('button')].find(b=>b.textContent==='Connect AniList').disabled");await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Connect AniList').click()");await wait("document.body.textContent.includes('Connected as Account fixture')");assert.equal(await run("document.querySelector('[aria-label=\"AniList access token\"]')===null"),true);
 await run("document.querySelector('[aria-label=\"Automatically back up AniList lists\"]').click()");await wait('fixture.settings.sources.anilistAutoBackup===true');
 await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Back up AniList now').click()");await wait('fixture.account.backupCount===1');
 await wait("![...document.querySelectorAll('button')].find(b=>b.textContent==='Export latest AniList backup').disabled");await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Export latest AniList backup').click()");await wait("document.body.textContent.includes('Backup exported')");
 await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Disconnect AniList').click()");await wait("document.querySelector('[aria-label=\"AniList access token\"]')");assert.equal(await run("document.querySelector('[aria-label=\"AniList access token\"]').value"),'');
 await run("document.querySelector('[aria-label=\"Anime card unwatched count\"]').click()");await wait('fixture.settings.privacy.animeUnwatchedCount===true');
 await run("document.querySelector('[aria-label=\"Manga card unread count\"]').click()");await wait('fixture.settings.privacy.mangaUnreadCount===true');
 await section('Torrents');await wait("document.querySelector('[aria-label=\"Download category\"]')");assert.equal(await run("document.querySelector('input[type=password]').value"),'');assert.equal(await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Test connection').disabled"),true);
 await run("document.querySelector('[aria-label=\"Enable qBittorrent\"]').click()");await wait('fixture.settings.downloads.qbittorrentEnabled===true');
 await run("[...document.querySelectorAll('a')].find(a=>a.textContent==='Open downloads').click()");await wait("document.body.textContent.includes('Fixture download')");
 await wait("document.querySelector('[aria-label=\"Pause Fixture download\"]')");await run("document.querySelector('[aria-label=\"Pause Fixture download\"]').click()");await wait("fixture.paused==='a'.repeat(40)");
 await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Add transfer').click()");await wait("document.querySelector('textarea')");
 await run("var field=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'magnet:?xt=urn:btih:fixture');field.dispatchEvent(new Event('input',{bubbles:true}))");
 await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Add to qBittorrent').click()");await wait("fixture.added?.[0]==='magnet:?xt=urn:btih:fixture'");
 await run("[...document.querySelectorAll('a')].find(a=>a.textContent==='Connection settings').click()");await wait("document.querySelector('[aria-label=\"Download category\"]')");
 await section('Diagnostics');await wait("document.body.textContent.includes('Last stream failed')");assert.equal(await run("document.body.textContent.includes('taking too long') || document.body.textContent.includes('load this video in time')"),true);
 await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Check extension updates').click()");await wait("document.body.textContent.includes('Update 1.1.0 available')");assert.equal(await run("document.body.textContent.includes('Update 9.0.0')"),false);
 await section('Updates');await wait("document.querySelector('#app-updates')");
 await section('Interface & Appearance');await wait("document.querySelector('[aria-label=\"Interface preview\"]')");
 await run("[...document.querySelectorAll('button')].find(b=>b.textContent==='Reset interface').click()");await wait("document.documentElement.dataset.colorMode==='dark'");
 if(process.env.VESTRA_SETTINGS_SCREENSHOT){const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(path.dirname(process.env.VESTRA_SETTINGS_SCREENSHOT),{recursive:true});for(const width of [1280,700]){win.setContentSize(width,900);await new Promise(r=>setTimeout(r,350));fs.writeFileSync(process.env.VESTRA_SETTINGS_SCREENSHOT+'-'+width+'.png',(await win.webContents.capturePage()).toPNG());}}
 await run('fixtureRoot.unmount()');await wait('fixture.listeners.size===0');console.log('PASS setting search, dependency retention, default source, scanner JSON validation, live colors, settings navigation, immediate appearance, partial persistence, failure recovery, torrent setup, health, updates and cleanup');win.destroy();app.exit(0);
 }catch(e){console.error(e);win?.destroy();app.exit(1);}});`,
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
      reject(Error("Settings UI timed out"));
    }, 60000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? accept()
        : reject(Error("Settings UI failed (" + code + ")"));
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
