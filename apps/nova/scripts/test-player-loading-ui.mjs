import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-loading-ui-"));
try {
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {PlayerChrome} from './renderer/src/components/player/player-chrome';createRoot(document.getElementById('root')).render(<PlayerChrome/>);`,
      resolveDir: nova,
      loader: "tsx",
    },
    tsconfig: join(nova, "renderer/tsconfig.json"),
    bundle: true,
    loader: { ".png": "dataurl" },
    format: "iife",
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
  const theme = (
    await readdir(join(nova, "dist-renderer/assets")).catch(() => [])
  ).find((file) => file.startsWith("theme-") && file.endsWith(".css"));
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html data-theme="vestra"><head>${theme ? `<link rel="stylesheet" href="${pathToFileURL(join(nova, "dist-renderer/assets", theme)).href}">` : ""}<link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script>
    window.fixture={commands:[],seeks:[],state:{running:true,idle:false,paused:false,position:40,duration:1440,volume:1,muted:false,speed:1,subtitleDelay:0,subtitleScale:1,tracks:[],chapters:[],subtitleVisible:true,error:null},playing:{title:'Fixture',episodeLabel:'Ep 1',index:0,total:2,sessionId:1,autoSkip:false,loading:true,skips:[{kind:'opening',startSeconds:30,endSeconds:120}]}};
    window.fixtureBridge={subtitleFonts:{installed:async()=>[],search:async q=>{if(fixture.rejectSearch)throw Error("fixture search failure");return ["Roboto"]},install:async family=>{fixture.installedFont=family;return family}},mpv:{onState:fn=>{fixture.stateChanged=fn;return ()=>{};},subscribe:async()=>fixture.state,setSubtitleFont:async n=>{if(fixture.rejectStyle)throw Error("fixture rejection");fixture.font=n},setSubtitleColor:async n=>{if(fixture.rejectStyle)throw Error("fixture rejection");fixture.color=n},seek:async n=>fixture.seeks.push(n)},player:{onNowPlaying:fn=>{fixture.playingChanged=fn;return ()=>{};},getNowPlaying:async()=>fixture.playing,setInteractive:async()=>{},send:async n=>fixture.commands.push(n),focus:async()=>{}},window:{isFullscreen:async()=>false}};
  </script><script src="fixture.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    `
    const {app,BrowserWindow}=require('electron');const assert=require('node:assert/strict');
    app.setPath("userData",${JSON.stringify(join(scratch, "profile"))});app.commandLine.appendSwitch('disable-gpu');app.whenReady().then(async()=>{
      const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,contextIsolation:false}});
      win.webContents.on("console-message",e=>{if(e.level==="error")console.error(e.message)});
      const capture=async name=>{const prefix=process.env.VESTRA_LOADER_SCREENSHOT;if(!prefix)return;require('node:fs').mkdirSync(require('node:path').dirname(prefix),{recursive:true});for(const width of [1200,375]){win.setContentSize(width,700);await new Promise(r=>setTimeout(r,200));require('node:fs').writeFileSync(prefix+'-'+name+'-'+width+'.png',(await win.webContents.capturePage()).toPNG());}win.setContentSize(1000,700);};
      const run=s=>win.webContents.executeJavaScript(s);const until=async s=>{for(let i=0;i<150;i++){if(await run('Boolean('+s+')'))return;await new Promise(r=>setTimeout(r,20));}throw Error('Timeout '+s);};
      try {
        await win.loadFile(${JSON.stringify(join(scratch, "index.html"))});
        await until('document.querySelector(".video-loader")');
        assert.equal(await run('getComputedStyle(document.querySelector(".video-loader-frame")).animationName'),'video-loader-frame');
        assert.equal(await run('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Skip opening"))'),false);
        assert.equal(await run('document.querySelector(".video-loader-title").textContent'),'Fixture · Ep 1');
        assert.equal(await run('!!document.querySelector(".video-loader--opening")'),true);
        assert.equal(await run('document.querySelector(".video-loader-copy").getAttribute("role")'),'status');
        await capture('opening');
        await run('fixture.playing={...fixture.playing,loading:false};fixture.playingChanged(fixture.playing)');
        await until('!document.querySelector(".video-loader")');
        await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Skip opening"))');
        await run('localStorage.setItem("vestra.subtitleFont","invalid; font");localStorage.setItem("vestra.subtitleColor","invalid-color");document.querySelector("button[aria-label=Settings]").click()');
        await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.startsWith("Subtitles"))');
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.startsWith("Subtitles")).click()');
        await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.startsWith("Font"))');
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.startsWith("Font")).click()');
        await until('document.querySelector("select")');
        assert.equal(await run('document.querySelector("select").value'),'');
        await run('var field=document.querySelector("select");field.value="Georgia";field.dispatchEvent(new Event("change",{bubbles:true}))');
        await until('fixture.font==="Georgia" && localStorage.getItem("vestra.subtitleFont")==="Georgia"');
        await run('fixture.rejectStyle=true;var field=document.querySelector("select");field.value="";field.dispatchEvent(new Event("change",{bubbles:true}))');
        await until('document.querySelector("[role=alert]")?.textContent.includes("Could not apply subtitle font")');
        assert.equal(await run('localStorage.getItem("vestra.subtitleFont")'),'Georgia');
        await run('fixture.rejectStyle=false;var field=document.querySelector("input[type=search]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,"Ro");field.dispatchEvent(new Event("input",{bubbles:true}))');
        await until('document.querySelector("[role=status]")?.textContent.includes("Searching")');
        await run('var field=document.querySelector("input[type=search]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,"");field.dispatchEvent(new Event("input",{bubbles:true}))');
        await until('!document.querySelector("[role=status]")?.textContent.includes("Searching")');
        await run('fixture.rejectSearch=true;var field=document.querySelector("input[type=search]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,"Ro");field.dispatchEvent(new Event("input",{bubbles:true}))');
        await until('document.querySelector("[role=alert]")?.textContent.includes("Could not search Google Fonts")');
        await run('fixture.rejectSearch=false;var field=document.querySelector("input[type=search]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(field,"Rob");field.dispatchEvent(new Event("input",{bubbles:true}))');
        await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Roboto"))');
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Roboto")).click()');
        await until('fixture.installedFont==="Roboto" && fixture.font==="Roboto" && localStorage.getItem("vestra.subtitleFont")==="Roboto"');
        await run('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
        await until('Array.from(document.querySelectorAll("button")).some(b=>b.textContent.startsWith("Colour"))');
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.startsWith("Colour")).click()');
        await until('Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Subtitle colour Yellow")');
        await run('fixture.rejectStyle=false;Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Subtitle colour Yellow").click()');
        await until('fixture.color==="#FFE600" && localStorage.getItem("vestra.subtitleColor")==="#FFE600"');
        await run('fixture.rejectStyle=true;Array.from(document.querySelectorAll("button")).find(b=>b.getAttribute("aria-label")==="Subtitle colour Cyan").click()');
        await until('document.querySelector("[role=alert]")?.textContent.includes("Could not apply subtitle colour")');
        assert.equal(await run('localStorage.getItem("vestra.subtitleColor")'),'#FFE600');
        await run('document.querySelector("button[aria-label=Settings]").click()');
        console.log('PASS subtitle menu navigation, validated preferences, font/colour apply and failed command recovery');
        await run('fixture.stateChanged({...fixture.state,buffering:true,bufferedSeconds:2.5,downloadBytesPerSecond:1048576})');
        await until('document.querySelector(".video-loader")?.textContent.includes("Buffering")');
        assert.ok(await run('document.querySelector(".video-loader-health")?.textContent.includes("2.5s buffered")'));
        assert.equal(await run('!!document.querySelector(".video-loader--buffering")'),true);
        assert.equal(await run('document.querySelector(".video-loader-health").getAttribute("aria-live")'),'off');
        await capture('buffering');
        assert.ok(await run('document.querySelector(".video-loader-health")?.textContent.includes("1.00 MiB/s")'));
        win.webContents.debugger.attach('1.3');
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        assert.equal(await run('getComputedStyle(document.querySelector(".video-loader-frame")).animationName'),'none');
        assert.equal(await run('getComputedStyle(document.querySelector(".video-loader-track span")).animationName'),'none');
        win.webContents.debugger.detach();
        await run('fixture.stateChanged({...fixture.state,buffering:true,bufferedSeconds:NaN,downloadBytesPerSecond:-1})');
        await until('!document.querySelector(".video-loader-health")');
        await run('fixture.playingChanged({...fixture.playing,playbackError:"No playable mirror was available. Sub: C# provider worker stopped. https://secret.example/private-token"})');
        await until('document.querySelector("[role=alert]")?.textContent.includes("Playback was interrupted")');
        assert.equal(await run('!!document.querySelector(".video-loader")'),false);
        await run('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Try again").click()');
        assert.equal(await run('fixture.commands.at(-1)'),'retry');
        assert.equal(await run('document.querySelector("[role=alert]").textContent.includes("C#")'),false);
        assert.equal(await run('document.querySelector("[role=alert]").textContent.includes("secret.example")'),false);
        await run('Array.from(document.querySelectorAll("[role=alert] button")).find(b=>b.textContent==="Close").click()');
        assert.equal(await run('fixture.commands.at(-1)'),'close');
        await run('fixture.playingChanged({...fixture.playing,playbackError:null});fixture.stateChanged({...fixture.state,error:"unrecognized private failure https://secret.example/token"})');
        await until('document.querySelector("[role=alert]")?.textContent.includes("We couldn")');
        assert.equal(await run('document.querySelector("[role=alert]").textContent.includes("secret")'),false);
        console.log('PASS native overlay animated loader, ready state, buffering, skip suppression and visible retry');
        win.destroy();app.exit(0);
      }catch(e){console.error(e);win.destroy();app.exit(1);}
    });
  `,
  );
  const require = createRequire(import.meta.url);
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
      reject(Error("Loading UI timed out"));
    }, 60000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(code, 0);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
