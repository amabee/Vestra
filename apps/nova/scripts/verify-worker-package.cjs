const { readFile, stat } = require("node:fs/promises");
const { join } = require("node:path");

module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== "win32" || context.arch !== 1)
    throw new Error(
      "The bundled provider worker currently supports Windows x64 packages only.",
    );
  const resources = join(context.packager.info.appDir, "vendor", "server");
  const manifest = JSON.parse(
    await readFile(join(resources, "worker-manifest.json"), "utf8"),
  );
  if (
    manifest.rid !== "win-x64" ||
    manifest.selfContained !== true ||
    manifest.protocol !== 1
  )
    throw new Error("Publish the Windows x64 worker before packaging Nova.");
  for (const file of [
    "Vestra.Server.exe",
    "coreclr.dll",
    "hostfxr.dll",
    "hostpolicy.dll",
  ])
    await stat(join(resources, file));
  await stat(
    join(
      context.packager.info.appDir,
      "dist-electron",
      "provider-typescript.cjs",
    ),
  );
};
