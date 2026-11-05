import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(nova, "node_modules/.security-ipc-"));
async function runner(config) {
  const { app, BrowserWindow } = require("electron");
  const assert = require("node:assert/strict");
  const { pathToFileURL } = require("node:url");
  const { join } = require("node:path");
  app.setPath("userData", join(config.scratch, "profile"));
  app.commandLine.appendSwitch("disable-gpu");
  await app.whenReady();
  const windows = [];
  try {
    const { handleIpc, secureWindow } = require("./security.cjs");
    let pauses = 0;
    for (const action of ["list", "dismiss", "restore"])
      handleIpc("continue-shelf:" + action, () => ({}));
    handleIpc("extensions:updates", () => []);
    handleIpc("app:version", () => "fixture");
    handleIpc("anilist-account:status", () => ({ connected: false }));
    handleIpc("anilist-account:change", () => ({ queued: true }));
    handleIpc("settings:get", () => ({ appearance: {} }));
    handleIpc("mpv:pause", () => ++pauses);
    const page = join(config.scratch, "index.html");
    const other = join(config.scratch, "other.html");
    const create = (preload) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          preload,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      windows.push(win);
      return win;
    };
    const main = create(config.preload);
    secureWindow(main, "main", pathToFileURL(page).href);
    await main.loadFile(page);
    assert.equal(
      await main.webContents.executeJavaScript("vestra.app.getVersion()"),
      "fixture",
    );
    assert.deepEqual(
      await main.webContents.executeJavaScript(
        "vestra.anilistAccount.status()",
      ),
      { connected: false },
    );
    assert.deepEqual(
      await main.webContents.executeJavaScript(
        "vestra.extensions.checkUpdates()",
      ),
      [],
    );
    assert.deepEqual(
      await main.webContents.executeJavaScript("vestra.continueShelf.list()"),
      {},
    );
    const rogue = create(config.preload);
    await rogue.loadFile(page);
    assert.equal(
      await rogue.webContents.executeJavaScript(
        "vestra.anilistAccount.change({}).then(()=>false,()=>true)",
      ),
      true,
    );
    assert.equal(
      await rogue.webContents.executeJavaScript(
        "vestra.anilistAccount.status().then(()=>false,()=>true)",
      ),
      true,
    );
    assert.equal(
      await rogue.webContents.executeJavaScript(
        "vestra.extensions.checkUpdates().then(()=>false,()=>true)",
      ),
      true,
    );
    for (const action of ["list", "dismiss", "restore"])
      assert.equal(
        await rogue.webContents.executeJavaScript(
          "vestra.continueShelf." + action + "({}).then(()=>false,()=>true)",
        ),
        true,
      );
    const player = create(config.playerPreload);
    secureWindow(player, "player", pathToFileURL(page).href);
    await player.loadFile(page);
    assert.equal(
      await player.webContents.executeJavaScript("typeof vestra.continueShelf"),
      "undefined",
    );
    assert.equal(
      await player.webContents.executeJavaScript("typeof vestra.extensions"),
      "undefined",
    );
    assert.equal(
      await player.webContents.executeJavaScript("vestra.mpv.pause()"),
      1,
    );
    assert.equal(
      await player.webContents.executeJavaScript(
        "typeof vestra.anilistAccount",
      ),
      "undefined",
    );
    assert.equal(
      await player.webContents.executeJavaScript("typeof vestra.sources"),
      "undefined",
    );
    assert.equal(
      await player.webContents.executeJavaScript(
        "typeof vestra.settings.patch",
      ),
      "undefined",
    );
    assert.equal(
      await player.webContents.executeJavaScript("typeof vestra.mpv.open"),
      "undefined",
    );
    assert.equal(
      await player.webContents.executeJavaScript(
        "typeof vestra.mpv.setSubtitleFont",
      ),
      "function",
    );
    assert.equal(
      await player.webContents.executeJavaScript(
        "typeof vestra.player.setQuality",
      ),
      "function",
    );
    await player.webContents.executeJavaScript(
      `location.href=${JSON.stringify(pathToFileURL(other).href)}`,
    );
    await new Promise((accept) => setTimeout(accept, 150));
    assert.equal(player.webContents.getURL(), pathToFileURL(page).href);
    await main.webContents.executeJavaScript(
      `var child=document.createElement('iframe');child.src=${JSON.stringify(pathToFileURL(other).href)};document.body.append(child)`,
    );
    for (let i = 0; i < 30 && !main.webContents.mainFrame.frames.length; i++)
      await new Promise((accept) => setTimeout(accept, 20));
    const frame = main.webContents.mainFrame.frames[0];
    assert.ok(frame);
    assert.equal(await frame.executeJavaScript("typeof vestra"), "undefined");
    // Programmatic main-process navigation can bypass will-navigate; authorization must still fail.
    await main.loadFile(other);
    assert.equal(
      await main.webContents.executeJavaScript(
        "vestra.app.getVersion().then(()=>false,()=>true)",
      ),
      true,
    );
    console.log(
      "PASS real Electron: trusted main, denied rogue/frame/navigated document, restricted player preload and blocked player navigation",
    );
    for (const win of windows) win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    for (const win of windows) if (!win.isDestroyed()) win.destroy();
    app.exit(1);
  }
}
try {
  await build({
    entryPoints: [join(nova, "electron/ipc-security.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: join(scratch, "security.cjs"),
  });
  await writeFile(
    join(scratch, "index.html"),
    "<!doctype html><title>Trusted fixture</title><body></body>",
  );
  await writeFile(
    join(scratch, "other.html"),
    "<!doctype html><title>Untrusted document</title>",
  );
  const config = {
    scratch,
    preload: join(nova, "dist-electron/preload.js"),
    playerPreload: join(nova, "dist-electron/preload-overlay.js"),
  };
  await writeFile(
    join(scratch, "runner.cjs"),
    `(${runner.toString()})(${JSON.stringify(config)}).catch(error=>{console.error(error);require('electron').app.exit(1)});`,
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
      reject(Error("Security IPC test timed out"));
    }, 30000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      try {
        assert.equal(code, 0);
        accept();
      } catch (error) {
        reject(error);
      }
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
