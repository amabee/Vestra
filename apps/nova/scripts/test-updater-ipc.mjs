import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(nova, "node_modules/.updater-ipc-"));
const require = createRequire(import.meta.url);
try {
  await build({
    stdin: {
      contents:
        "export {initAutoUpdate} from './electron/auto-update';export {autoUpdater} from 'electron-updater';",
      resolveDir: nova,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: join(scratch, "updates.cjs"),
  });
  await writeFile(
    join(scratch, "index.html"),
    "<!doctype html><title>Updater IPC test</title>",
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    `const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');const {createServer}=require('node:http');
  app.setPath('userData',${JSON.stringify(join(scratch, "profile"))});app.commandLine.appendSwitch('disable-gpu');
  app.whenReady().then(async()=>{let win,rogue,server;try{Object.defineProperty(app,'isPackaged',{value:true});app.getVersion=()=> '0.1.2';
    server=createServer((req,res)=>{assert.equal(new URL(req.url,'http://localhost').pathname,'/latest.yml');res.setHeader('Content-Type','application/yaml');res.end(JSON.stringify({version:'1.0.0',files:[{url:'test-installer.exe',sha512:Buffer.alloc(64).toString('base64'),size:100}],path:'test-installer.exe',sha512:Buffer.alloc(64).toString('base64'),releaseDate:new Date().toISOString(),releaseNotes:'Test feed only'}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const options={show:false,webPreferences:{preload:${JSON.stringify(join(nova, "dist-electron/preload.js"))},contextIsolation:true,nodeIntegration:false}};
    win=new BrowserWindow(options);const updates=require('./updates.cjs');updates.initAutoUpdate(()=>win);updates.autoUpdater.logger=null;updates.autoUpdater.setFeedURL({provider:'generic',url:'http://127.0.0.1:'+server.address().port});
    await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});
    const initial=await win.webContents.executeJavaScript('vestra.updates.state()');assert.equal(initial.currentVersion,'0.1.2');assert.equal(initial.phase,'idle');
    const checked=await win.webContents.executeJavaScript('vestra.updates.check()');assert.equal(checked.phase,'available');assert.equal(checked.version,'1.0.0');assert.equal(updates.autoUpdater.autoDownload,false);
    const protectedInstall=await win.webContents.executeJavaScript('vestra.updates.install()');assert.equal(protectedInstall.phase,'available');
    rogue=new BrowserWindow(options);await rogue.loadFile(${JSON.stringify(join(scratch, "index.html"))});const denied=await rogue.webContents.executeJavaScript('vestra.updates.state().then(()=>false,()=>true)');assert.equal(denied,true);
    console.log('PASS: real bundled updater + Electron HTTP feed + trusted IPC + install gate + rejected secondary window');rogue.destroy();win.destroy();server.close();app.exit(0);
  }catch(error){console.error(error);rogue?.destroy();win?.destroy();server?.close();app.exit(1);}});`,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PORTABLE_EXECUTABLE_DIR;
  await new Promise((accept, reject) => {
    const child = spawn(require("electron"), [join(scratch, "runner.cjs")], {
      env,
      windowsHide: true,
      stdio: "inherit",
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Updater IPC test timed out"));
    }, 30000);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? accept()
        : reject(Error(`Updater IPC test failed (${code})`));
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
