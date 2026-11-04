import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(nova, "node_modules/.startup-ui-"));
async function runner(config) {
  const { app, BrowserWindow } = require("electron");
  const { pathToFileURL } = require("node:url");
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const assert = require("node:assert/strict");
  app.setPath("userData", path.join(config.scratch, "profile"));
  app.commandLine.appendSwitch("disable-gpu");
  await app.whenReady();
  const {
    createStartupWindow,
    secureWindow,
    handleIpc,
  } = require("./startup.cjs");
  handleIpc("app:version", () => app.getVersion());
  const main = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: config.mainPreload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  secureWindow(main, "main", pathToFileURL(config.mainPage).href);
  const start = createStartupWindow({
    icon: config.icon,
    rendererRoot: config.rendererRoot,
    main: () => main,
  });
  try {
    await start.shown;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const splash = BrowserWindow.getAllWindows().find((win) => win !== main);
    assert.equal(
      splash.isVisible(),
      true,
      JSON.stringify(
        BrowserWindow.getAllWindows().map((win) => ({
          id: win.id,
          title: win.getTitle(),
          visible: win.isVisible(),
          url: win.webContents.getURL(),
        })),
      ),
    );
    assert.equal(main.isVisible(), false);
    await main.loadFile(config.mainPage);
    const run = (code) => splash.webContents.executeJavaScript(code);
    assert.deepEqual(await run("Object.keys(novaStartup).sort()"), [
      "continue",
      "onChanged",
      "quit",
      "retry",
      "state",
    ]);
    assert.equal(await run("typeof vestra"), "undefined");
    assert.equal(await run("novaStartup.continue()"), false);
    await run("document.fonts.ready");
    assert.equal(
      await run("document.querySelector('.mascot').naturalWidth>0"),
      true,
    );
    assert.equal(
      await run("document.documentElement.scrollHeight<=innerHeight"),
      true,
      "Splash fits its native window without scrolling",
    );
    await run("document.querySelector('#motion').click()");
    assert.equal(await run("document.body.classList.contains('paused')"), true);
    await run("document.querySelector('#motion').click()");
    start.gate.step("config", "ready");
    start.gate.step("cache", "loading");
    start.gate.step("extensions", "loading");
    start.gate.update("checking");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await fs.mkdir(config.captures, { recursive: true });
    await fs.writeFile(
      path.join(config.captures, "splash-desktop.png"),
      (await splash.webContents.capturePage()).toPNG(),
    );
    splash.setContentSize(375, 740);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      await run("document.documentElement.scrollWidth<=innerWidth"),
      true,
    );
    await fs.writeFile(
      path.join(config.captures, "splash-narrow.png"),
      (await splash.webContents.capturePage()).toPNG(),
    );
    splash.setContentSize(800, 540);
    splash.webContents.send("startup:changed", {
      ...start.gate.snapshot(),
      error: true,
      canContinue: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(await run("document.querySelector('#retry').hidden"), false);
    assert.equal(await run("novaStartup.continue()"), false);
    // A compromised splash document with the full main preload still has no privileged access.
    const rogue = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: config.mainPreload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    secureWindow(rogue, "splash", pathToFileURL(config.mainPage).href);
    await rogue.loadFile(config.mainPage);
    assert.equal(
      await rogue.webContents.executeJavaScript(
        "vestra.startup.ready(0).then(()=>false,()=>true)",
      ),
      true,
    );
    assert.equal(
      await rogue.webContents.executeJavaScript(
        "vestra.app.getVersion().then(()=>false,()=>true)",
      ),
      true,
    );
    rogue.destroy();
    splash.webContents.debugger.attach("1.3");
    await splash.webContents.debugger.sendCommand(
      "Emulation.setEmulatedMedia",
      { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
    );
    assert.equal(
      await run(
        "getComputedStyle(document.querySelector('.mascot')).animationName",
      ),
      "none",
    );
    splash.webContents.debugger.detach();
    await main.webContents.executeJavaScript("vestra.startup.ready(0)");
    assert.equal(start.gate.snapshot().canContinue, true);
    assert.equal(main.isVisible(), false);
    start.gate.update("offline");
    start.gate.step("extensions", "ready");
    assert.equal(main.isVisible(), true);
    assert.equal(splash.isDestroyed(), true);
    console.log(
      "PASS real splash: mascot and offline fonts, progress and error states, responsive layout, pause control, early-handoff guard and restricted preload/IPC",
    );
    start.gate.dispose();
    main.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}
try {
  await build({
    stdin: {
      contents: `export {createStartupWindow} from './electron/startup-window';export {secureWindow, handleIpc} from './electron/ipc-security';`,
      resolveDir: nova,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    outfile: join(scratch, "startup.cjs"),
  });
  await copyFile(
    join(nova, "dist-electron/preload-splash.js"),
    join(scratch, "preload-splash.js"),
  );
  const mainPage = join(scratch, "main.html");
  await writeFile(
    mainPage,
    "<!doctype html><title>Nova fixture</title><body>Ready</body>",
  );
  const config = {
    scratch,
    mainPage,
    mainPreload: join(nova, "dist-electron/preload.js"),
    rendererRoot: join(nova, "dist-renderer"),
    icon: join(nova, "build/icon.png"),
    captures: join(nova, "../../.hallmark"),
  };
  await writeFile(
    join(scratch, "runner.cjs"),
    `(${runner.toString()})(${JSON.stringify(config)}).catch(error=>{console.error(error);require('electron').app.exit(1)});`,
  );
  await writeFile(
    join(scratch, "package.json"),
    JSON.stringify({
      name: "nova-startup-fixture",
      version: JSON.parse(await readFile(join(nova, "package.json"), "utf8"))
        .version,
      main: "runner.cjs",
    }),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((accept, reject) => {
    const child = spawn(createRequire(import.meta.url)("electron"), [scratch], {
      env,
      windowsHide: false,
      stdio: "inherit",
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("Startup UI test timed out"));
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
