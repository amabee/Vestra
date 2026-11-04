import { build } from "esbuild";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(nova, "node_modules/.update-prompt-ui-"));
const require = createRequire(import.meta.url);

async function runner(config) {
  const { app, BrowserWindow } = require("electron");
  const assert = require("node:assert/strict");
  const fs = require("node:fs/promises");
  const path = require("node:path");
  app.setPath("userData", path.join(config.scratch, "profile"));
  app.commandLine.appendSwitch("disable-gpu");
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1040,
    height: 850,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  try {
    await win.loadFile(path.join(config.scratch, "index.html"));
    const run = async (source) => {
      try {
        return await win.webContents.executeJavaScript(source);
      } catch (error) {
        throw Error(source + ": " + error.message);
      }
    };
    const wait = async (source) => {
      const end = Date.now() + 7000;
      while (Date.now() < end) {
        if (await run(source)) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw Error("Update prompt did not reach " + source);
    };
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const click = (label) =>
      run(
        `document.querySelector('dialog[open] button[aria-label=${JSON.stringify(label)}]').click()`,
      );
    const capture = async (name, width, height) => {
      if (!config.screenshots) return;
      win.setContentSize(width, height);
      await pause(150);
      assert.equal(
        await run("document.documentElement.scrollWidth<=innerWidth"),
        true,
      );
      assert.equal(
        await run(
          "(()=>{const b=document.querySelector('dialog[open]').getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight})()",
        ),
        true,
      );
      await fs.mkdir(config.screenshots, { recursive: true });
      await fs.writeFile(
        path.join(config.screenshots, name + ".png"),
        (await win.webContents.capturePage()).toPNG(),
      );
    };
    await wait("fixture.listeners.size===2");
    assert.equal(
      await run("document.querySelectorAll('dialog[open]').length"),
      0,
    );
    await run(
      "fixturePlayer.setState({item:{id:'playing'}});fixture.push({phase:'available',version:'0.2.8'})",
    );
    await pause(1100);
    assert.equal(
      await run("document.querySelectorAll('dialog[open]').length"),
      0,
      "Announcements must wait for playback",
    );
    await run(
      "fixture.visible=false;fixturePlayer.setState({item:null});document.dispatchEvent(new Event('visibilitychange'))",
    );
    await pause(100);
    assert.equal(
      await run("document.querySelectorAll('dialog[open]').length"),
      0,
      "Announcements must wait for a visible window",
    );
    await run(
      "fixture.visible=true;document.getElementById('other').showModal();document.dispatchEvent(new Event('visibilitychange'))",
    );
    await pause(100);
    assert.equal(
      await run(
        "document.querySelectorAll('.nova-update-dialog[open]').length",
      ),
      0,
      "Announcements must not stack over another modal",
    );
    await run(
      "document.getElementById('other').close();document.querySelector('[aria-haspopup=dialog]').focus();document.dispatchEvent(new Event('visibilitychange'))",
    );
    await wait(
      "document.querySelector('.nova-update-dialog[open]')&&document.querySelector('.nova-update-mascot img').complete",
    );
    assert.equal(await run("fixture.downloads+fixture.installs"), 0);
    assert.equal(
      await run(
        "document.querySelector('dialog[open]').contains(document.activeElement)",
      ),
      true,
    );
    assert.equal(
      await run(
        "document.querySelectorAll('.nova-update-notes img,.nova-update-notes script').length",
      ),
      0,
    );
    assert.equal(
      await run(
        "document.querySelector('.nova-update-notes strong').textContent",
      ),
      "Complete manga ports",
    );
    await run(
      "window.oldConfetti=document.querySelector('.nova-update-confetti')",
    );
    await click("Celebrate this update with confetti");
    await pause(80);
    assert.equal(
      await run(
        "!oldConfetti.isConnected && document.querySelectorAll('.nova-update-confetti i').length===32",
      ),
      true,
    );
    await capture("available-desktop", 1040, 850);
    await capture("available-compact", 420, 760);
    await run("document.documentElement.dataset.colorMode='light'");
    await capture("available-light", 1040, 850);
    await run("document.documentElement.dataset.colorMode='dark'");
    await run(
      "document.querySelector('dialog[open]').dispatchEvent(new Event('cancel',{cancelable:true}))",
    );
    await wait("!document.querySelector('.nova-update-dialog[open]')");
    assert.equal(
      await run("document.activeElement.getAttribute('aria-haspopup')"),
      "dialog",
    );
    await run(
      "fixture.push({phase:'checking'});fixture.push({phase:'available'})",
    );
    await pause(1100);
    assert.equal(
      await run(
        "document.querySelectorAll('.nova-update-dialog[open]').length",
      ),
      0,
      "Same-version checks must not nag",
    );
    await run("document.querySelector('[aria-haspopup=dialog]').click()");
    await wait("document.querySelector('.nova-update-dialog[open]')");
    await run(
      "[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Download update').click()",
    );
    await wait("document.querySelector('dialog[open] progress')?.value===42");
    assert.equal(await run("fixture.installs"), 0);
    await run(
      "fixture.push({phase:'error',message:'Connection interrupted.'})",
    );
    await wait(
      "document.querySelector('dialog[open] [role=alert]')?.textContent==='Connection interrupted.'",
    );
    await run(
      "[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Retry download').click()",
    );
    await wait("fixture.downloads===2");
    await run(
      "[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Keep browsing').click()",
    );
    await wait("!document.querySelector('.nova-update-dialog[open]')");
    await run("fixture.push({phase:'downloaded',message:null,progress:null})");
    await wait(
      "document.querySelector('.nova-update-dialog[open]')&&document.body.textContent.includes('Let’s roll.')",
    );
    await capture("ready-desktop", 1040, 850);
    win.webContents.debugger.attach("1.3");
    await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    assert.equal(
      await run(
        "getComputedStyle(document.querySelector('.nova-update-confetti')).display",
      ),
      "none",
    );
    win.webContents.debugger.detach();
    assert.equal(await run("fixture.installs"), 0);
    await run(
      "[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Restart and install').click()",
    );
    await wait("fixture.installs===1");
    await run("fixtureRoot.unmount()");
    await wait("fixture.listeners.size===0");
    console.log(
      "PASS update modal: playback/visibility/modal deferral, focus/Escape, safe notes, replayable confetti, Later/deduplication, progress/retry, explicit restart, reduced motion and cleanup",
    );
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win.destroy();
    app.exit(1);
  }
}

try {
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {UpdatePrompt} from './renderer/src/components/updates/update-prompt';import {UpdateIndicator} from './renderer/src/components/updates/app-updates';import {usePlayer} from './renderer/src/lib/player-store';window.fixturePlayer=usePlayer;window.fixtureRoot=createRoot(document.getElementById('root'));fixtureRoot.render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><UpdateIndicator/><UpdatePrompt/></QueryClientProvider>);`,
      resolveDir: nova,
      loader: "tsx",
    },
    bundle: true,
    format: "iife",
    tsconfig: join(nova, "renderer/tsconfig.json"),
    loader: { ".png": "dataurl" },
    outfile: join(scratch, "ui.js"),
    plugins: [
      {
        name: "bridge",
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
  const main = await readFile(join(nova, "dist-renderer/index.html"), "utf8");
  const css = [...main.matchAll(/<link[^>]*href="([^"]+\.css)"/g)]
    .map(
      (m) =>
        `<link rel="stylesheet" href="${pathToFileURL(resolve(nova, "dist-renderer", m[1])).href}">`,
    )
    .join("");
  if (!css) throw Error("Build the renderer before testing the update modal.");
  const notes =
    '<h2>A fresh chapter for Nova</h2><ul><li><strong>Complete manga ports</strong> in Foundry.</li><li>Better support for manga image CDNs.</li><li>A little celebration for your next update.</li></ul><img src="https://notes.invalid/tracker"><script>window.fixtureAttack=1</script>';
  await writeFile(
    join(scratch, "index.html"),
    `<!doctype html><html data-theme="vestra"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body style="padding:2rem"><div id="root"></div><dialog id="other">Other task</dialog><script>
    window.fixture={visible:true,state:{phase:'idle',currentVersion:'0.2.7',version:null,releaseNotes:${JSON.stringify(notes).replace(/</g, "\\u003c")},lastCheckedAt:null,progress:null,message:null},listeners:new Set(),downloads:0,installs:0};Object.defineProperty(document,'visibilityState',{get:()=>fixture.visible?'visible':'hidden'});
    fixture.push=s=>{fixture.state={...fixture.state,...s};for(const listener of fixture.listeners)listener(structuredClone(fixture.state));};
    window.fixtureBridge={updates:{state:async()=>fixture.state,onChanged:listener=>{fixture.listeners.add(listener);return()=>fixture.listeners.delete(listener);},download:async()=>{fixture.downloads++;fixture.push({phase:'downloading',progress:{percent:42,total:104857600,transferred:44040192,bytesPerSecond:2097152}});return fixture.state;},install:async()=>{fixture.installs++;fixture.push({phase:'installing'});return fixture.state;}}};
  </script><script src="ui.js"></script></body></html>`,
  );
  await writeFile(
    join(scratch, "runner.cjs"),
    `(${runner.toString()})(${JSON.stringify({ scratch, screenshots: process.env.VESTRA_UPDATE_SCREENSHOTS ?? null })});`,
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
      reject(Error("Update modal fixture timed out"));
    }, 45000);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? accept()
        : reject(Error("Update modal fixture failed (" + code + ")"));
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
