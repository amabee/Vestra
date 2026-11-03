import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
const scratch = await mkdtemp(resolve("apps/nova/node_modules/.list-sync-ui-"));
try {
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {DEFAULT_SETTINGS} from '@vestra/types';import {AniListListControl} from './apps/nova/renderer/src/components/media/anilist-list-control';import {AniListConnection} from './apps/nova/renderer/src/components/settings/anilist-connection';fixture.client=new QueryClient({defaultOptions:{queries:{retry:false}}});fixture.settings=structuredClone(DEFAULT_SETTINGS);createRoot(document.getElementById('root')).render(<QueryClientProvider client={fixture.client}><AniListConnection settings={fixture.settings} update={()=>{}}/><AniListListControl type="MANGA" source="anilist" id="91" title="A quiet journey"/></QueryClientProvider>);`,
      resolveDir: resolve("."),
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    outfile: join(scratch, "fixture.js"),
    nodePaths: [resolve("apps/nova/node_modules")],
    tsconfig: resolve("apps/nova/renderer/tsconfig.json"),
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
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html><body><div id="root"></div><script>
window.fixture={changes:[],syncs:0,settings:null};
fixture.status={connected:true,user:{id:1,name:'Reader',url:'https://anilist.co/user/1',avatar:null},encryptionAvailable:true,needsReconnect:false,loadError:false,backingUp:false,lastBackupAt:null,lastBackupError:null,nextBackupAttemptAt:null,backupCount:0,sync:{pending:0,syncing:false,lastSyncAt:100,lastError:null,retryAt:null,unmatched:0}};
fixture.entries=[{id:1091,mediaId:91,status:'CURRENT',progress:7,updatedAt:100,media:{id:91,type:'MANGA',title:{english:'A quiet journey'},episodes:null,chapters:24,seasonYear:null}}];
window.fixtureBridge={anilistAccount:{status:async()=>structuredClone(fixture.status),lists:async()=>structuredClone(fixture.entries),onChanged:listener=>{fixture.listener=listener;return()=>{}},change:async value=>{fixture.changes.push(value);fixture.status.sync.pending=1;return structuredClone(fixture.status)},sync:async()=>{fixture.syncs++;fixture.status.sync.pending=0;fixture.status.sync.lastSyncAt++;fixture.status.sync.lastError=null;return structuredClone(fixture.status)}}};
fixture.publish=()=>{fixture.listener(structuredClone(fixture.status));fixture.client.invalidateQueries({queryKey:['anilist-lists']});};
</script><script src="fixture.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    `
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');
app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{let win;try{
win=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,offscreen:true,backgroundThrottling:false}});await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});
const run=async s=>{try{return await win.webContents.executeJavaScript(s)}catch(error){console.error('Failed UI script',s);throw error}},wait=async s=>{const end=Date.now()+7000;while(Date.now()<end){if(await run('Boolean('+s+')'))return;await new Promise(r=>setTimeout(r,20));}throw Error('UI did not reach '+s)};
await wait('document.querySelector("select")?.value==="CURRENT"');
assert.ok(await run('document.body.textContent.includes("7 chapters read")'));
await run('(()=>{const input=document.querySelector("select");const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set;setter.call(input,"PAUSED");input.dispatchEvent(new Event("change",{bubbles:true}));})()');
await wait('fixture.changes.length===1');
assert.equal(await run('fixture.changes[0].status'),'PAUSED');assert.equal(await run('fixture.changes[0].type'),'MANGA');assert.equal(await run('fixture.changes[0].mediaId'),91);
await wait('document.body.textContent.includes("1 pending")');
await run('[...document.querySelectorAll("button")].find(b=>b.textContent==="Sync AniList now").click()');await wait('fixture.syncs===1');await wait('document.body.textContent.includes("0 pending")');
await run('fixture.status.sync.lastError="AniList is rate limiting requests.";fixture.status.sync.retryAt=Date.now()+60000;fixture.publish()');await wait('document.body.textContent.includes("rate limiting")');assert.equal(await run('[...document.querySelectorAll("button")].find(b=>b.textContent==="Sync AniList now").disabled'),true);
console.log('PASS AniList imported reading status/progress, status changes, pending queue, manual sync and retry feedback');win.destroy();app.exit(0);
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
      reject(Error("AniList sync UI timed out"));
    }, 30000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? accept() : reject(Error("AniList sync UI failed " + code));
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
