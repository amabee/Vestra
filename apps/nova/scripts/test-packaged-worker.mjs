import { build } from "esbuild";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const resourcesIndex = process.argv.indexOf("--resources");
const resources =
  resourcesIndex >= 0 ? resolve(process.argv[resourcesIndex + 1]) : null;
const target = join(
  resources ?? join(nova, "vendor"),
  "server",
  "Vestra.Server.exe",
);
const scratch = await mkdtemp(join(tmpdir(), "vestra-packaged-worker-"));
after(() => rm(scratch, { recursive: true, force: true }));
await build({
  entryPoints: {
    worker: join(nova, "electron/csharp-worker.ts"),
    transpile: join(nova, "electron/provider-transpile.ts"),
    target: join(nova, "electron/worker-target.ts"),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: scratch,
});
if (resources) {
  const builder = createRequire(
    require.resolve("electron-builder/package.json"),
  );
  const lib = createRequire(builder.resolve("app-builder-lib/package.json"));
  const asar = lib("@electron/asar");
  const archive = join(resources, "app.asar");
  await writeFile(
    join(scratch, "provider-typescript.cjs"),
    asar.extractFile(archive, "dist-electron/provider-typescript.cjs"),
  );
  assert.ok(
    asar.extractFile(archive, "dist-electron/typescript-LICENSE.txt").length >
      0,
  );
  assert.ok(asar.extractFile(archive, "dist-electron/main.js").length > 0);
} else {
  await copyFile(
    join(nova, "dist-electron/provider-typescript.cjs"),
    join(scratch, "provider-typescript.cjs"),
  );
}
const { CSharpProviderSession, workerCommand } = require(
  join(scratch, "worker.js"),
);
const { resolveWorkerTarget } = require(join(scratch, "target.js"));
const { transpileProvider } = require(join(scratch, "transpile.js"));

// Hide SDK tools and redirect runtime discovery in this test's children only.
const environment = {
  ...process.env,
  PATH: join(process.env.SystemRoot ?? "C:/Windows", "System32"),
  DOTNET_ROOT: join(scratch, "no-dotnet"),
  DOTNET_ROOT_X64: join(scratch, "no-dotnet"),
  DOTNET_MULTILEVEL_LOOKUP: "0",
  VESTRA_TEST_WORKER_TARGET: target,
};
test("installed target selection ignores development overrides and reports missing workers", async () => {
  const selected = resolveWorkerTarget({
    packaged: true,
    resourcesPath: resources ?? scratch,
    appPath: "unused",
    platform: "win32",
    arch: "x64",
    dllOverride: "untrusted.dll",
  });
  assert.equal(
    selected,
    join(resources ?? scratch, "server", "Vestra.Server.exe"),
  );
  assert.deepEqual(workerCommand(target), {
    executable: target,
    args: ["--provider-worker"],
  });
  assert.throws(
    () => workerCommand(join(scratch, "absent.exe")),
    /worker is missing/,
  );
  assert.throws(
    () =>
      resolveWorkerTarget({
        packaged: true,
        resourcesPath: scratch,
        appPath: "unused",
        platform: "win32",
        arch: "arm64",
      }),
    /Windows x64/,
  );
  assert.equal(
    resolveWorkerTarget({
      packaged: false,
      resourcesPath: scratch,
      appPath: nova,
      platform: "win32",
      arch: "x64",
      dllOverride: "development.dll",
    }),
    "development.dll",
  );
  for (const file of ["coreclr.dll", "hostfxr.dll", "hostpolicy.dll"])
    await stat(join(dirname(target), file));
  const config = JSON.parse(
    await readFile(
      join(dirname(target), "Vestra.Server.runtimeconfig.json"),
      "utf8",
    ),
  );
  assert.ok(config.runtimeOptions.includedFrameworks.length > 0);
  assert.equal(config.runtimeOptions.frameworks, undefined);
});

test("bundled compiler works outside node_modules and loads TypeScript in the self-contained worker", async () => {
  assert.throws(
    () =>
      transpileProvider("import x from 'x'; class Provider {}", "module.ts"),
    /modules\/imports/,
  );
  const script = transpileProvider(
    `class Provider {
    getSettings(): {episodeServers:string[],supportsDub:boolean} { return {episodeServers:['bundled'],supportsDub:false}; }
    search(options: unknown): unknown[] { return []; }
    findEpisodes(id: string): unknown[] { return []; }
    findEpisodeServer(ep: unknown, server: string): unknown { return {server,videoSources:[]}; }
  }`,
    "provider.ts",
  );
  const saved = {};
  for (const key of [
    "PATH",
    "DOTNET_ROOT",
    "DOTNET_ROOT_X64",
    "DOTNET_MULTILEVEL_LOOKUP",
  ]) {
    saved[key] = process.env[key];
    process.env[key] = environment[key];
  }
  let client;
  try {
    client = new CSharpProviderSession(target, join(scratch, "data"));
    await client.request({
      kind: "load",
      provider: { id: "typescript", source: script, hosts: [] },
    });
    assert.deepEqual(
      (
        await client.request({
          kind: "call",
          providerId: "typescript",
          method: "getSettings",
          args: [],
        })
      ).episodeServers,
      ["bundled"],
    );
  } finally {
    client?.stop();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("worker protocol regression suite passes with SDK tools hidden", async () => {
  await new Promise((accept, reject) => {
    const child = spawn(
      process.execPath,
      [join(nova, "scripts/test-csharp-worker.mjs")],
      { env: environment, stdio: "inherit", windowsHide: true },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error(`Packaged worker tests failed (${code}).`)),
    );
  });
});
