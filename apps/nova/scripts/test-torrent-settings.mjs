import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const scratch = await mkdtemp(join(tmpdir(), "vestra-torrent-settings-"));
const root = resolve(".");
try {
  await build({
    stdin: {
      contents: `export * from './apps/nova/electron/qbittorrent-settings'; export {getServerEnv,setQbittorrentCredentials} from './packages/config/src/env';export {getQbittorrentStatus,resetQbittorrentSession} from './packages/api/src/qbittorrent/client';export {DEFAULT_SETTINGS} from './packages/types/src/settings';export {getDriver} from './apps/nova/electron/services';`,
      resolveDir: root,
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(scratch, "test.cjs"),
    plugins: [
      {
        name: "fixtures",
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "mock",
          }));
          b.onResolve(
            { filter: /(?:^\.\/services$|\/electron\/services$)/ },
            () => ({ path: "services", namespace: "mock" }),
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents:
              args.path === "services"
                ? `const store=new Map();const driver={read:async key=>store.get(key)??null,write:async(key,value)=>{store.set(key,value);}};export const getDriver=()=>driver;export const resolveDataDir=()=>${JSON.stringify(scratch)};`
                : `import {createCipheriv,createDecipheriv} from 'node:crypto';const key=Buffer.alloc(32,8),iv=Buffer.alloc(16,3);export const ipcMain={handle:(name,handler)=>globalThis.handlers.set(name,handler)};export const safeStorage={isEncryptionAvailable:()=>globalThis.encryption!==false,getSelectedStorageBackend:()=> 'secret_service',encryptString:value=>{const cipher=createCipheriv('aes-256-cbc',key,iv);return Buffer.concat([cipher.update(value),cipher.final()]);},decryptString:value=>{const cipher=createDecipheriv('aes-256-cbc',key,iv);return Buffer.concat([cipher.update(value),cipher.final()]).toString();}};`,
          }));
        },
      },
    ],
  });
  process.env.QBITTORRENT_URL = "http://localhost:8080";
  process.env.QBITTORRENT_USERNAME = "environment-user";
  process.env.QBITTORRENT_PASSWORD = "environment-password";
  const api = createRequire(import.meta.url)(join(scratch, "test.cjs"));
  await api.loadQbittorrentSettings();
  assert.equal(api.qbittorrentSettingsStatus().source, "environment");
  await api.saveQbittorrentSettings({
    url: "http://localhost:8081",
    username: "saved-user",
    password: "secret-password",
  });
  assert.equal(api.qbittorrentSettingsStatus().saved, true);
  assert.equal(api.getServerEnv().QBITTORRENT_PASSWORD, "secret-password");
  assert.ok(
    !(await readFile(join(scratch, "qbittorrent-credentials.enc"))).includes(
      Buffer.from("secret-password"),
    ),
  );
  assert.ok(
    !JSON.stringify(api.qbittorrentSettingsStatus()).includes(
      "secret-password",
    ),
  );
  await api.loadQbittorrentSettings();
  assert.equal(api.qbittorrentSettingsStatus().saved, true);
  await assert.rejects(
    api.saveQbittorrentSettings({
      url: "file:///tmp/client",
      username: "user",
      password: "pass",
    }),
  );
  await assert.rejects(
    api.saveQbittorrentSettings({
      url: "http://user:pass@localhost",
      username: "user",
      password: "pass",
    }),
  );
  globalThis.encryption = false;
  await assert.rejects(
    api.saveQbittorrentSettings({
      url: "http://localhost:8082",
      username: "user",
      password: "pass",
    }),
  );
  globalThis.encryption = true;
  await api.saveQbittorrentSettings(null);
  assert.equal(api.getServerEnv().QBITTORRENT_PASSWORD, "environment-password");
  await writeFile(join(scratch, "qbittorrent-credentials.enc"), "corrupted");
  await api.loadQbittorrentSettings();
  assert.equal(api.qbittorrentSettingsStatus().loadError, true);
  const originalFetch = globalThis.fetch;
  const requests = [];
  const own = "a".repeat(40),
    other = "b".repeat(40);
  const raw = (category) => ({
    hash: category === "mine" ? own : other,
    name: "Fixture",
    state: "downloading",
    progress: 0.5,
    size: 100,
    downloaded: 50,
    dlspeed: 10,
    upspeed: 0,
    eta: 5,
    save_path: "fixture",
    category,
  });
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({
      host: parsed.host,
      path: parsed.pathname,
      cookie: options.headers?.Cookie,
      method: options.method,
    });
    if (parsed.pathname.endsWith("/auth/login"))
      return new Response("Ok.", {
        headers: { "set-cookie": `SID=${parsed.port}; HttpOnly` },
      });
    if (parsed.pathname.endsWith("/app/version")) return new Response("v5.0.0");
    if (parsed.pathname.endsWith("/torrents/info"))
      return Response.json([raw("mine"), raw("other")]);
    if (parsed.pathname.endsWith("/torrents/add"))
      return new Response(globalThis.addFails ? "Fails." : "Ok.");
    if (parsed.pathname.endsWith("/torrents/stop") && globalThis.stopFailure)
      return new Response("", { status: globalThis.stopFailure });
    return new Response("");
  };
  try {
    api.resetQbittorrentSession();
    assert.equal((await api.getQbittorrentStatus()).connected, true);
    api.setQbittorrentCredentials({
      url: "http://localhost:8082",
      username: "second",
      password: "second-secret",
    });
    assert.equal((await api.getQbittorrentStatus()).connected, true);
    assert.equal(
      requests.filter((row) => row.path.endsWith("/auth/login")).length,
      2,
    );
    assert.equal(requests.at(-1).cookie, "SID=8082");
    globalThis.handlers = new Map();
    api.registerTorrentIpc();
    const invoke = (name, value) => handlers.get(name)({}, value);
    await assert.rejects(invoke("torrents:list"), /Enable/);
    await api.getDriver().write("settings", {
      ...api.DEFAULT_SETTINGS,
      downloads: {
        ...api.DEFAULT_SETTINGS.downloads,
        qbittorrentEnabled: true,
        category: "mine",
      },
    });
    const listed = await invoke("torrents:list");
    assert.equal(listed.length, 1);
    assert.equal(listed[0].category, "mine");
    await assert.rejects(invoke("torrents:pause", other), /outside/);
    assert.ok(!requests.some((row) => row.path.endsWith("/torrents/stop")));
    await invoke("torrents:pause", own);
    assert.ok(requests.some((row) => row.path.endsWith("/torrents/stop")));
    await assert.rejects(
      invoke("torrents:add", ["file:///private.torrent"]),
      /Only magnet/,
    );
    globalThis.addFails = true;
    await assert.rejects(
      invoke("torrents:add", ["magnet:?xt=urn:btih:fixture"]),
      /could not add/,
    );
    globalThis.addFails = false;
    globalThis.stopFailure = 503;
    await assert.rejects(invoke("torrents:pause", own), /503/);
    assert.equal(
      requests.filter((row) => row.path.endsWith("/torrents/pause")).length,
      0,
    );
    globalThis.stopFailure = 404;
    await invoke("torrents:pause", own);
    assert.equal(
      requests.filter((row) => row.path.endsWith("/torrents/pause")).length,
      1,
    );
    delete globalThis.stopFailure;
    delete globalThis.addFails;
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.handlers;
  }
  console.log(
    "PASS encrypted torrent credentials, restart, reset, corruption, connection isolation and category-restricted IPC",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
