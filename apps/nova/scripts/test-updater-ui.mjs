import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(nova, "node_modules/.updater-ui-"));
const require = createRequire(import.meta.url);
try {
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router';import {AppUpdatesPanel,UpdateIndicator} from './renderer/src/components/updates/app-updates';window.fixtureRoot=createRoot(document.getElementById('root'));fixtureRoot.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><UpdateIndicator/><AppUpdatesPanel/></MemoryRouter></QueryClientProvider>);`,
      resolveDir: nova,
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    tsconfig: join(nova, "renderer/tsconfig.json"),
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
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html><body><div id="root"></div><script>
  const base={phase:'disabled',currentVersion:'0.1.2',version:null,releaseNotes:'',lastCheckedAt:null,progress:null,message:'Installed builds only'};
  window.fixture={state:base,listeners:new Set(),checks:0,downloads:0,installs:0};
  fixture.push=s=>{fixture.state={...fixture.state,...s};for(const listener of fixture.listeners)listener(structuredClone(fixture.state));};
  window.fixtureBridge={updates:{state:async()=>structuredClone(fixture.state),onChanged:listener=>{fixture.listeners.add(listener);return()=>fixture.listeners.delete(listener);},check:async()=>{fixture.checks++;fixture.push({phase:'available',version:'1.0.0',message:null,releaseNotes:'<img src=x onerror=alert(1)>'});return fixture.state;},download:async()=>{fixture.downloads++;fixture.push({phase:'downloading',progress:{percent:50,transferred:50,total:100,bytesPerSecond:25}});return fixture.state;},install:async()=>{fixture.installs++;fixture.push({phase:'installing'});return fixture.state;}},shell:{openExternal:async()=>{}}};
  </script><script src="ui.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    `const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});app.commandLine.appendSwitch('disable-gpu');
  app.whenReady().then(async()=>{let win;try{win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});
  const run=s=>win.webContents.executeJavaScript(s);const wait=async s=>{const end=Date.now()+5000;while(Date.now()<end){if(await run(s))return;await new Promise(r=>setTimeout(r,20));}throw Error('UI did not reach '+s);};
  await wait("document.body.textContent.includes('Updates unavailable for this run')");assert.equal(await run("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Check for updates')).disabled"),true);
  await run("fixture.push({phase:'idle',message:null})");await wait("document.body.textContent.includes('Ready to check')");
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Check for updates')).click()");await wait("document.body.textContent.includes('Version 1.0.0 is available')");assert.equal(await run('fixture.downloads'),0);assert.equal(await run("document.querySelectorAll('img').length"),0);
  assert.equal(await run("document.querySelector('a[href*=settings]').textContent.includes('1.0.0')"),true);
  await run("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Download update')).click()");await wait("document.querySelector('progress')?.value===50");assert.equal(await run('fixture.installs'),0);
  await run("fixture.push({phase:'downloaded',progress:null})");await wait("document.body.textContent.includes('Restart and install')");await run("[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Restart and install')).click()");await wait('fixture.installs===1');
  await run("fixtureRoot.unmount()");await wait('fixture.listeners.size===0');console.log('PASS: updater UI disabled state, explicit actions, progress, notification, escaped notes and subscription cleanup');win.destroy();app.exit(0);
  }catch(e){console.error(e);win?.destroy();app.exit(1);}});`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((accept, reject) => {
    const child = spawn(require("electron"), [join(scratch, "runner.cjs")], {
      env,
      windowsHide: true,
      stdio: "inherit",
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Updater UI test timed out"));
    }, 30000);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? accept() : reject(Error(`Updater UI test failed (${code})`));
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
