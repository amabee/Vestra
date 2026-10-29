import { build } from "esbuild";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const scratch = await mkdtemp(join(nova, "node_modules/.reader-ui-"));
// Synthetic local PNG: no provider traffic, real decoding and real scroll geometry.
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type),
    length = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(Buffer.concat([name, bytes])));
  return Buffer.concat([length, name, bytes, crc]);
}
const width = 256,
  height = 1024,
  header = Buffer.alloc(13);
header.writeUInt32BE(width);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 2;
const pixels = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    pixels[offset] = 40 + Math.floor(y / 128) * 20;
    pixels[offset + 1] = 90;
    pixels[offset + 2] = 120;
  }
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(pixels)),
  chunk("IEND", Buffer.alloc(0)),
]);
try {
  await build({
    stdin: {
      contents: `
      import React, { StrictMode, useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { BookReader, MangaRoute } from './renderer/src/routes/manga';
      import { MemoryRouter } from 'react-router';
      import { seriesOptionsKey } from './renderer/src/lib/manga-reader';
      const f = window.readerFixture;
      localStorage.setItem(seriesOptionsKey('fixture','a'), JSON.stringify({layout:'webtoon'}));
      function Fixture() {
        const [book, choose] = useState('a'); f.choose = choose;
        if(book==='__library__') return <MangaRoute />;
        return <BookReader key={book} provider="fixture" book={{id:book,title:'Fixture '+book}} onBack={() => { f.exited = true; }} />;
      }
      createRoot(document.getElementById('root')).render(<StrictMode><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><Fixture /></MemoryRouter></QueryClientProvider></StrictMode>);
    `,
      resolveDir: nova,
      loader: "tsx",
    },
    bundle: true,
    jsx: "automatic",
    format: "iife",
    platform: "browser",
    outfile: join(scratch, "fixture.js"),
    tsconfig: join(nova, "renderer/tsconfig.json"),
    plugins: [
      {
        name: "fixture-bridge",
        setup(build) {
          build.onResolve({ filter: /^@\/lib\/bridge$/ }, () => ({
            path: "bridge",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const bridge = window.readerFixture.bridge;",
            loader: "js",
          }));
        },
      },
    ],
  });
  const cssName = (await readdir(join(nova, "dist-renderer/assets"))).find(
    (name) => name.endsWith(".css"),
  );
  if (!cssName) throw new Error("Build the renderer before this UI fixture.");
  const css = await readFile(
    join(nova, "dist-renderer/assets", cssName),
    "utf8",
  );
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html data-theme="vestra-dark"><head><style>${css}</style></head><body style="margin:0;height:100vh"><div id="root"></div><script>
    window.readerFixture = { calls: [], saves: [], fail: true, exited:false, bridge: { manga: {
      sources: async () => [{id:'fixture',name:'Manga source'},{id:'second',name:'Second source'}],
      search: async (provider,query) => { const f=window.readerFixture; f.searches??=[]; f.searches.push({provider,query}); if(query==='none')return []; return Array.from({length:9},(_,index)=>({id:'result-'+index,title:['A Quiet Journey','The Last Horizon','City of Lanterns','After the Rain','Moonlit Garden','A New Beginning','Paper Worlds','Beyond the Clouds','Small Adventures'][index],...(index===2?{}:{cover:provider+'-cover-'+index})})); },
      recent: async () => ({entries:[{book:{id:'recent-a',title:'A Quiet Journey',cover:'cover-recent'},progress:{chapterId:'one',page:13,updatedAt:'2026-10-29T16:00:00Z'}},{book:{id:'recent-b',title:'City of Lanterns'},progress:{chapterId:'one',page:3,updatedAt:'2026-10-29T12:00:00Z'}},{book:{id:'recent-c',title:'After the Rain',cover:'cover-broken'},progress:{chapterId:'one',page:0,updatedAt:'2026-10-28T16:00:00Z'}}],unreadable:0,truncated:false}),
      chapters: async () => [{id:'one',title:'Chapter 1',chapter:'1',index:0},{id:'two',title:'Chapter 2',chapter:'2',index:1}],
      progress: async () => null,
      pages: async (_p,_b,c) => Array.from({length:40},(_,index)=>({handle:c+'-'+index,index})),
      image: async (handle) => { const f=window.readerFixture; f.calls.push(handle); if(handle==='cover-broken')return 'data:image/png;base64,AAE='; if(f.slow===handle) await new Promise(resolve=>{f.releaseSlow=resolve;}); if(f.fail && handle==='one-5') throw new Error('Fixture image failure'); return ${JSON.stringify("data:image/png;base64," + png.toString("base64"))}; },
      save: async (_p,b,c,page) => { window.readerFixture.saves.push({book:b,chapter:c,page}); },
    }}};
  </script><script src="fixture.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    `
    const {app,BrowserWindow}=require('electron');
    const assert=require('node:assert/strict');
    app.disableHardwareAcceleration();
    app.whenReady().then(async()=>{
      // Offscreen and never shown: this fixture cannot take over the user's desktop.
      const win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{offscreen:true,backgroundThrottling:false,sandbox:true,contextIsolation:true}});
      win.webContents.on('console-message',(event)=>{if(event.level==='error') console.error(event.message);});
      const run=(source)=>win.webContents.executeJavaScript(source).catch(error=>{console.error('Eval failed:',source);throw error;});
      const pause=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
      const until=async(source)=>{for(let n=0;n<160;n++){if(await run(source))return;await pause(50);}throw new Error('Timed out: '+source);};
      const key=(value)=>run('window.dispatchEvent(new KeyboardEvent("keydown",{key:'+JSON.stringify(value)+',bubbles:true,cancelable:true}))');
      const jump=(page)=>run('(()=>{const e=document.querySelector("input[aria-label^=Reading]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+page+');e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()');
      try {
        await win.loadURL(${JSON.stringify(pathToFileURL(join(scratch, "index.html")).href)});
        await until('window.readerFixture.saves.some(s=>s.page===0)');
        assert.ok(await run('window.readerFixture.calls.length < 12'),'vertical reader must not fetch the entire chapter');
        assert.equal(await run('document.querySelectorAll("[aria-label^=Vertical]").length'),1);
        console.log('PASS vertical initial load is bounded and saves the decoded visible page');
        await jump(6);
        await until('document.body.textContent.includes("Fixture image failure")');
        await pause(400);
        assert.equal(await run('window.readerFixture.saves.some(s=>s.page===5)'),false);
        await run('window.readerFixture.fail=false;[...document.querySelectorAll("button")].find(e=>e.textContent==="Retry image").click()');
        await until('window.readerFixture.saves.some(s=>s.page===5)');
        console.log('PASS slider jumps, failed images do not advance progress, and retry resumes saving');
        await jump(15);
        await until('window.readerFixture.saves.some(s=>s.page===14)');
        await key('ArrowRight');
        await until('window.readerFixture.saves.some(s=>s.page===15)');
        await until('document.querySelector("[aria-label^=Vertical]").getAttribute("aria-busy")==="false"');
        await run('document.querySelector("[aria-label^=Vertical]").scrollBy({top:4200})');
        await until('window.readerFixture.saves.some(s=>s.page>15)');
        assert.ok(await run('document.querySelectorAll("img").length < 12'));
        console.log('PASS actual vertical scrolling tracks progress while releasing offscreen images');
        const beforeSpace=await run('document.querySelector("[aria-label^=Vertical]").scrollTop');
        await key(' ');
        await until('document.querySelector("[aria-label^=Vertical]").scrollTop > '+beforeSpace);
        await run('document.querySelector("[aria-label^=Vertical]").dispatchEvent(new WheelEvent("wheel",{deltaY:-100,ctrlKey:true,bubbles:true,cancelable:true}))');
        await until('Object.values(localStorage).some(value=>JSON.parse(value).zoom===105)');
        await run('document.querySelector("[aria-label^=Vertical]").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}))');
        await until('Object.values(localStorage).every(value=>JSON.parse(value).zoom===100)');
        console.log('PASS Space scrolls the vertical canvas and wheel zoom/reset persists per series');
        await run('window.readerFixture.slow="one-29"');
        await jump(30);
        await until('typeof window.readerFixture.releaseSlow==="function"');
        await key(' ');
        await until('document.querySelector("[aria-label^=Vertical]").getAttribute("aria-busy")==="false"');
        await until('document.querySelector("[aria-label^=Vertical]").getBoundingClientRect().top-document.querySelectorAll("[data-page]")[29].getBoundingClientRect().top>100');
        await run('window.readerFixture.releaseSlow()');
        await until('document.querySelectorAll("[data-page]")[29].querySelector("img")?.complete');
        assert.ok(await run('document.querySelector("[aria-label^=Vertical]").getBoundingClientRect().top-document.querySelectorAll("[data-page]")[29].getBoundingClientRect().top>100'));
        console.log('PASS keyboard scrolling interrupts a pending image jump instead of snapping back');
        await key('s');
        await until('document.querySelector("aside[aria-label^=Reader]")');
        await key('Escape');
        await until('!document.querySelector("aside[aria-label^=Reader]")');
        const clickPage=()=>run('(()=>{const e=document.querySelector("[data-reader-canvas]");e.dispatchEvent(new PointerEvent("pointerdown",{clientX:100,clientY:150,bubbles:true}));e.dispatchEvent(new MouseEvent("click",{detail:1,clientX:100,clientY:150,bubbles:true}));})()');
        const canvasHeight=await run('document.querySelector("[data-reader-canvas]").clientHeight');
        await clickPage();
        await until('document.querySelector("header").inert');
        await run('document.querySelector("section").dispatchEvent(new PointerEvent("pointermove",{bubbles:true}))');
        await pause(2600);
        assert.equal(await run('document.querySelector("header").inert'),true);
        assert.equal(await run('document.querySelector("[data-reader-canvas]").clientHeight'),canvasHeight);
        await clickPage();
        await until('!document.querySelector("header").inert');
        console.log('PASS page click hides/reveals controls without timers, pointer reveal or canvas resizing');
        assert.equal(await run('[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==="Immersive reading").textContent'), '');
        assert.equal(await run('[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==="Reader settings").textContent'), '');
        assert.ok(await run('(()=>{const r=document.querySelector("[data-reader-title]").getBoundingClientRect();return Math.abs(r.left+r.width/2-innerWidth/2)<2;})()'));
        assert.ok(await run('(()=>{const r=document.querySelector("[data-reader-pagination]").getBoundingClientRect();return Math.abs(r.left+r.width/2-innerWidth/2)<2;})()'));
        await run('[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==="Choose chapter").click()');
        await until('document.querySelector("#reader-chapters")');
        assert.ok(await run('document.querySelector("#reader-chapters").getBoundingClientRect().bottom < document.querySelector("[data-reader-actions]").getBoundingClientRect().top'));
        if(process.env.VESTRA_READER_SCREENSHOT) require('node:fs').writeFileSync(process.env.VESTRA_READER_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
        await key('Escape');
        console.log('PASS centered title/pagination, icon controls and bottom-right upward chapter menu');
        const savedBefore=await run('JSON.stringify(window.readerFixture.saves)');
        await run('(()=>{const e=document.querySelector("input[aria-label^=Reading]"),r=e.getBoundingClientRect();e.dispatchEvent(new PointerEvent("pointermove",{pointerType:"mouse",clientX:r.left+r.width/2,bubbles:true}));})()');
        await until('document.querySelector("[role=tooltip] img")?.complete');
        assert.ok(await run('document.querySelector("[role=tooltip]").textContent.includes("Page 21")'));
        assert.equal(await run('JSON.stringify(window.readerFixture.saves)'),savedBefore);
        await run('document.querySelector("input[aria-label^=Reading]").parentElement.dispatchEvent(new PointerEvent("pointerleave",{bubbles:false}))');
        console.log('PASS progress hover displays the requested page thumbnail without changing reading progress');
        await run('window.readerFixture.choose("b")');
        await until('document.body.textContent.includes("Fixture b") && !document.querySelector("[aria-label^=Vertical]")');
        await until('document.body.textContent.includes("Try Webtoon mode?")');
        await key('s');
        await until('document.querySelector("aside[aria-label^=Reader]")');
        await run('window.readerFixture.settingsBefore=document.querySelector("aside[aria-label^=Reader]");document.querySelector("select").dispatchEvent(new KeyboardEvent("keydown",{key:"s",bubbles:true,cancelable:true}))');
        assert.equal(await run('!!document.querySelector("aside[aria-label^=Reader]")'),true);
        await key('Escape');
        console.log('PASS tall images recommend Webtoon and editable settings retain their keys');
        await run('window.readerFixture.choose("a")');
        await until('document.querySelector("[aria-label^=Vertical]")');
        console.log('PASS a second series keeps its own defaults and the first restores Webtoon mode');
        await run('window.readerFixture.choose("__library__")');
        await until('document.querySelector("[data-manga-library]")');
        await until('[...document.querySelectorAll("img")].some(e=>e.alt==="Cover of A Quiet Journey" && e.complete && e.naturalWidth>0)');
        assert.equal(await run('document.querySelectorAll("section[aria-label^=Continue] button").length'),3);
        await until('[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==="Continue After the Rain").textContent.includes("No cover available")');
        assert.ok(await run('[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==="Continue City of Lanterns").textContent.includes("No cover available")'));
        console.log('PASS cover shelf renders real decoded artwork and clean missing/broken-cover fallbacks');
        await run('(()=>{const e=document.querySelector("input[placeholder^=Search]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"quiet");e.dispatchEvent(new Event("input",{bubbles:true}));})()');
        await run('document.querySelector("input[placeholder^=Search]").closest("form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
        await until('document.body.textContent.includes("Results for")');
        await until('[...document.querySelectorAll("button")].some(e=>e.getAttribute("aria-label")==="Read A Quiet Journey")');
        assert.equal(await run('document.querySelectorAll("section[aria-label^=Continue]").length'),0);
        await until('[...document.querySelectorAll("img")].some(e=>e.alt==="Cover of A Quiet Journey" && e.complete && e.naturalWidth>0)');
        if(process.env.VESTRA_LIBRARY_SCREENSHOT) require('node:fs').writeFileSync(process.env.VESTRA_LIBRARY_SCREENSHOT,(await win.webContents.capturePage()).toPNG());
        await run('[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==="Read A Quiet Journey").click()');
        await until('document.querySelector("[data-reader-title]")?.textContent==="A Quiet Journey"');
        await run('[...document.querySelectorAll("button")].find(e=>e.textContent.includes("Library")).click()');
        await until('document.querySelector("[data-manga-library]") && !document.querySelector("[data-reader-title]")');
        await run('[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==="Clear manga search").click()');
        await until('document.querySelector("section[aria-label^=Continue]")');
        console.log('PASS library search opens the reader and returns to a clean Continue Reading shelf');
        win.destroy(); app.exit(0);
      } catch(error) {console.error(error);win.destroy();app.exit(1);}
    });
  `,
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const exit = await new Promise((resolve, reject) => {
    const child = spawn(require("electron"), [join(scratch, "runner.cjs")], {
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Reader UI fixture exceeded 90 seconds"));
    }, 90000);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  if (exit !== 0) throw new Error("Reader UI fixture failed (" + exit + ")");
} finally {
  await rm(scratch, { recursive: true, force: true });
}
