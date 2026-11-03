import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const scratch = await mkdtemp(join(tmpdir(), "vestra-settings-services-"));
try {
  await build({
    stdin: {
      contents: `export {refreshLocalLibrary} from './apps/nova/electron/library-refresh'; export {loadExtension,callExtension} from './apps/nova/electron/extensions'; export {getDriver} from './apps/nova/electron/services'; export {createSettingsPatcher} from './apps/nova/electron/settings-service'; export {DEFAULT_SETTINGS} from './packages/types/src/settings';`,
      resolveDir: resolve("."),
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(scratch, "test.cjs"),
    plugins: [
      {
        name: "host-fixtures",
        setup(b) {
          b.onResolve({ filter: /(^|\/)services$/ }, () => ({
            path: "services",
            namespace: "host",
          }));
          b.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "host",
          }));
          b.onLoad({ filter: /.*/, namespace: "host" }, (args) => ({
            resolveDir: resolve("."),
            contents:
              args.path === "services"
                ? `import {MemoryDriver} from './packages/storage/src/driver'; const driver=new MemoryDriver(); export const getDriver=()=>driver; export const getProviderRegistry=()=>({});`
                : `import {EventEmitter} from 'node:events'; export const BrowserWindow={getAllWindows:()=>[]}; export const utilityProcess={fork:()=>{ const child=new EventEmitter(); child.postMessage=message=>queueMicrotask(()=>child.emit('message',{kind:'result',id:message.id,ok:true,value:{methods:[]}})); return child; }};`,
          }));
        },
      },
    ],
  });
  const m = createRequire(import.meta.url)(join(scratch, "test.cjs"));
  const patch = m.createSettingsPatcher(m.getDriver());
  await patch({ library: { autoMatchMetadata: false } });
  const first = m.refreshLocalLibrary(),
    second = m.refreshLocalLibrary();
  assert.equal(
    first,
    second,
    "Overlapping scan requests share the same promise",
  );
  await first;
  assert.notEqual(
    m.refreshLocalLibrary(),
    first,
    "The scan lock releases after completion",
  );
  const basic = {
    extensionId: "basic",
    granted: ["network"],
    allowedHosts: ["example.org"],
    grantedForVersion: "1.0.0",
    grantedAt: new Date().toISOString(),
  };
  const elevated = {
    ...basic,
    extensionId: "elevated",
    granted: ["network", "network:session"],
  };
  await m.loadExtension({ extensionId: "basic", source: "", grant: basic });
  await m.loadExtension({
    extensionId: "elevated",
    source: "",
    grant: elevated,
  });
  await m.callExtension("elevated", "test", []);
  await patch({ extensions: { secureMode: true } });
  await assert.rejects(m.callExtension("elevated", "test", []), /Secure Mode/);
  await m.callExtension("basic", "test", []);
  await patch({ extensions: { secureMode: false } });
  await m.callExtension("elevated", "test", []);
  await Promise.all([
    patch({ privacy: { trackHistory: false } }),
    patch.transform((current) => ({
      ...current,
      library: {
        ...current.library,
        folders: [
          {
            id: "fixture",
            path: "C:\\fixture",
            label: null,
            enabled: true,
            lastScannedAt: null,
            fileCount: 0,
          },
        ],
      },
    })),
  ]);
  let saved;
  await patch.transform((current) => {
    saved = current;
    return current;
  });
  assert.equal(saved.privacy.trackHistory, false);
  assert.equal(saved.library.folders.length, 1);
  console.log(
    "PASS scan request coordination and lock release, live Secure Mode enforcement and compatibility, folder/setting concurrent mutation",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
