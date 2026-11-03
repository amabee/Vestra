import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const scratch = await mkdtemp(join(tmpdir(), "vestra-settings-expansion-"));
try {
  await build({
    stdin: {
      contents: `export * from './packages/types/src/settings'; export {registryFetchUrl} from './apps/nova/electron/extension-registry'; export * from './packages/storage/src/repositories'; export {NodeDriver} from './packages/storage/src/node-driver'; export {scanLibrary} from './packages/providers/src/scanner'; export {createSettingsPatcher} from './apps/nova/electron/settings-service'; export {STORAGE_KEYS} from './packages/config/src/constants';`,
      resolveDir: resolve("."),
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(scratch, "test.cjs"),
  });
  const m = createRequire(import.meta.url)(join(scratch, "test.cjs"));
  const driver = new m.NodeDriver(join(scratch, "data"));
  assert.equal(
    m.registryFetchUrl(m.LEGACY_VESTRA_REGISTRY_URL),
    m.FOUNDRY_REGISTRY_URL,
  );
  assert.equal(
    m.registryFetchUrl(m.FOUNDRY_REGISTRY_URL),
    m.FOUNDRY_REGISTRY_URL,
  );
  for (const url of [
    "https://example.com/custom-registry.json",
    m.LEGACY_VESTRA_REGISTRY_URL + "?custom=1",
  ])
    assert.equal(m.registryFetchUrl(url), url);
  const defaults = await m.getSettings(driver);
  assert.deepEqual(defaults.extensions.registries, [
    "https://raw.githubusercontent.com/amabee/Foundry/main/extensions/registry.json",
  ]);
  for (const registries of [
    [],
    ["https://example.com/custom-registry.json"],
    [
      "https://raw.githubusercontent.com/amabee/Vestra/main/extensions/registry.json",
    ],
  ]) {
    assert.deepEqual(
      m.extensionSettingsSchema.parse({ registries }).registries,
      registries,
    );
  }
  assert.equal(defaults.playback.autoUpdateProgress, true);
  assert.equal(defaults.privacy.showAdultContent, false);
  await driver.write(m.STORAGE_KEYS.settings, {
    version: 1,
    appearance: { theme: "light", customAccent: "broken" },
    privacy: { trackHistory: false },
    library: { scanOnStartup: false },
  });
  const recovered = await m.getSettings(driver);
  assert.equal(recovered.appearance.theme, "light");
  assert.equal(recovered.appearance.customAccent, null);
  assert.equal(recovered.privacy.trackHistory, false);
  assert.equal(recovered.library.scanOnStartup, false);
  assert.equal(recovered.library.scanner.maxDepth, 8);
  const broadcasts = [];
  const patch = m.createSettingsPatcher(driver, (value) =>
    broadcasts.push(value),
  );
  await Promise.all([
    patch({ appearance: { backgroundColor: "#112233" } }),
    patch({ appearance: { mediaBannerSize: "small" } }),
    patch({ privacy: { hideAnimeSpoilers: true } }),
    patch({ library: { autoRefresh: true } }),
  ]);
  const restarted = await m.getSettings(
    new m.NodeDriver(join(scratch, "data")),
  );
  assert.equal(restarted.appearance.backgroundColor, "#112233");
  assert.equal(restarted.appearance.mediaBannerSize, "small");
  assert.equal(restarted.appearance.theme, "light");
  assert.equal(restarted.library.autoRefresh, true);
  assert.equal(broadcasts.length, 4);
  assert.throws(() => patch({ appearance: { bannerOpacity: 2 } }));
  assert.throws(() => patch({ library: { folders: [] } }));
  assert.throws(() => patch({ extensions: { registries: [] } }));
  assert.equal(m.scannerConfigSchema.safeParse({ maxDepth: 0 }).success, false);
  assert.equal(
    m.scannerConfigSchema.safeParse({ maxFiles: "100" }).success,
    false,
  );
  assert.equal(
    m.scannerConfigSchema.safeParse({ excludedDirectories: ["../escape"] })
      .success,
    false,
  );
  assert.equal(
    m.scannerConfigSchema.safeParse({ unknown: true }).success,
    false,
  );
  const local = {
    format: "vestra-local-config",
    version: 1,
    library: { ...restarted.library },
  };
  delete local.library.folders;
  assert.equal(m.localConfigurationSchema.safeParse(local).success, true);
  assert.equal(
    m.localConfigurationSchema.safeParse({ ...local, token: "secret" }).success,
    false,
  );
  assert.equal(
    m.localConfigurationSchema.safeParse({
      ...local,
      library: { ...local.library, folders: [] },
    }).success,
    false,
  );
  const mediaRoot = join(scratch, "media");
  await mkdir(join(mediaRoot, "excluded"), { recursive: true });
  await writeFile(join(mediaRoot, "show-01.mp4"), "fixture");
  await writeFile(join(mediaRoot, "excluded", "show-02.mp4"), "fixture");
  const library = {
    ...defaults.library,
    scanner: { ...defaults.library.scanner, excludedDirectories: ["excluded"] },
    folders: [
      {
        id: "fixture",
        path: mediaRoot,
        label: null,
        enabled: true,
        lastScannedAt: null,
        fileCount: 0,
      },
    ],
  };
  const first = await m.scanLibrary(driver, library);
  assert.equal(first.added, 1);
  const again = await m.scanLibrary(driver, library);
  assert.equal(again.added, 0);
  assert.equal(again.files[0].addedAt, first.files[0].addedAt);
  const offline = await m.scanLibrary(driver, {
    ...library,
    folders: [{ ...library.folders[0], path: join(scratch, "offline") }],
  });
  assert.equal(offline.errors.length, 1);
  assert.equal(offline.files.length, 1);
  assert.equal(offline.removed, 0);
  const removedRoot = await m.scanLibrary(driver, { ...library, folders: [] });
  assert.equal(removedRoot.files.length, 1);
  const otherRoot = join(scratch, "other-media");
  await mkdir(otherRoot);
  await writeFile(join(otherRoot, "other-01.mp4"), "fixture");
  await Promise.all([
    m.scanLibrary(driver, library),
    m.scanLibrary(driver, {
      ...library,
      folders: [{ ...library.folders[0], id: "other", path: otherRoot }],
    }),
  ]);
  assert.equal(
    (await m.getLocalFiles(driver)).length,
    2,
    "Concurrent scanner callers with different roots retain both discoveries",
  );
  console.log(
    "PASS settings defaults, field recovery, concurrent patches, restart persistence, strict import boundaries, scanner validation, exclusions, repeated scans and unavailable-root retention",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
