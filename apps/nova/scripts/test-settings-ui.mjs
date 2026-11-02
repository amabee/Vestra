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
 window.fixture={settings:null,listeners:new Set(),patches:[],reject:false};
 window.fixtureBridge={extensions:{installed:async()=>[{id:'fixture',version:'1.0.0',registryUrl:'registry-fixture'}],browse:async()=>({entries:[{id:'fixture',version:'9.0.0',registryUrl:'other-registry'},{id:'fixture',version:'1.1.0',registryUrl:'registry-fixture'}],errors:[]})},settings:{get:async()=>structuredClone(fixture.settings),onChanged:fn=>{fixture.listeners.add(fn);return()=>fixture.listeners.delete(fn);},patch:async patch=>{if(fixture.reject)throw Error('disk failure');fixture.patches.push(patch);for(const [key,value] of Object.entries(patch))fixture.settings[key]={...fixture.settings[key],...value};for(const fn of fixture.listeners)fn(structuredClone(fixture.settings));return structuredClone(fixture.settings);}},app:{diagnostics:async()=>({providers:[],counts:{localFiles:2},dataDir:'fixture',extensions:[]}),sourceHealth:async()=>[{id:'ext-fixture',name:'Fixture source',enabled:true,loaded:true,kind:'native',observation:{state:'failed',at:new Date().toISOString(),durationMs:10,code:'timeout'}}],playbackDiagnostics:async()=>[],copyPlaybackDiagnostics:async()=>{}},torrents:{configuration:async()=>({configured:false,saved:false,encryptionAvailable:true,url:'http://localhost:8080',username:'',source:'none'}),test:async()=>({connected:true,version:'v5',error:null}),save:async()=>{},list:async()=>[{hash:'a'.repeat(40),name:'Fixture download',state:'downloading',progress:.5,sizeBytes:100,downloadedBytes:50,downloadSpeed:10,uploadSpeed:0}],pause:async hash=>{fixture.paused=hash},resume:async()=>{},add:async urls=>{fixture.added=urls}},updates:{state:async()=>({phase:'disabled',currentVersion:'0.1.2',message:'Installed builds only'}),onChanged:()=>()=>{}},library:{folders:async()=>[]}};
 </script><script src="ui.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    String.raw`const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});app.commandLine.appendSwitch('disable-gpu');app.whenReady().then(async()=>{let win;try{
 win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});
 const run=async s=>{try{return await win.webContents.executeJavaScript(s);}catch(e){console.error("Failed script:",s);throw e;}};const wait=async s=>{const end=Date.now()+5000;while(Date.now()<end){if(await run("Boolean("+s+")"))return;await new Promise(r=>setTimeout(r,20));}throw Error('UI did not reach '+s);};
 const section=async id=>{await run("[...document.querySelectorAll('[aria-label=\"Settings sections\"] button')].find(b=>b.textContent.startsWith("+JSON.stringify(id)+")).click()");};
 await wait("document.querySelector('[aria-label=\"Interface preview\"]')");assert.equal(await run("document.documentElement.dataset.colorMode"),'dark');
 await run("[...document.querySelectorAll('[aria-label=Theme] button')].find(b=>b.textContent==='Light').click()");await wait("document.documentElement.dataset.colorMode==='light'");
 await run("document.querySelector('[aria-label=\"Show navigation labels\"]').click()");await wait("fixture.settings.appearance.sidebarLabels===true");assert.equal(await run('fixture.settings.appearance.theme'),'light');
 await run("var select=document.querySelector('[aria-label=\"Text size\"]');select.value='large';select.dispatchEvent(new Event('change',{bubbles:true}))");await wait("document.documentElement.style.fontSize==='18px'");
 await section('App');await wait("document.querySelector('[aria-label=\"Start page\"]')");await run("var select=document.querySelector('[aria-label=\"Start page\"]');select.value='/manga';select.dispatchEvent(new Event('change',{bubbles:true}))");await wait("fixture.settings.app.startupPage==='/manga'");
 await run("fixture.reject=true;document.querySelector('[aria-label=\"Show status bar\"]').click()");await wait("document.querySelector('[role=alert]')?.textContent.includes('could not be saved')");assert.equal(await run('fixture.settings.app.showStatusBar'),true);await run('fixture.reject=false');
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
 await section('User Interface');await wait("document.querySelector('[aria-label=\"Interface preview\"]')");
 if(process.env.VESTRA_SETTINGS_SCREENSHOT){const fs=require('node:fs'),path=require('node:path');fs.mkdirSync(path.dirname(process.env.VESTRA_SETTINGS_SCREENSHOT),{recursive:true});for(const width of [1280,700]){win.setContentSize(width,900);await new Promise(r=>setTimeout(r,350));fs.writeFileSync(process.env.VESTRA_SETTINGS_SCREENSHOT+'-'+width+'.png',(await win.webContents.capturePage()).toPNG());}}
 await run('fixtureRoot.unmount()');await wait('fixture.listeners.size===0');console.log('PASS settings navigation, immediate appearance, partial persistence, failure recovery, torrent setup, health, updates and cleanup');win.destroy();app.exit(0);
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
    }, 30000);
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
