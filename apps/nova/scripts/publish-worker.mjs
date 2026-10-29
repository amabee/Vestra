import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("Worker packaging currently supports Windows x64 builds.");
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(nova, "vendor");
const destination = join(vendor, "server");
await mkdir(vendor, { recursive: true });
const staging = await mkdtemp(join(vendor, ".server-publish-"));
const backup = join(vendor, ".server-backup-" + Date.now());
function ownedPath(path) {
  const absolute = resolve(path);
  if (
    dirname(absolute) !== vendor ||
    !(
      absolute === destination ||
      /^\.server-(?:publish|backup)-/.test(absolute.slice(vendor.length + 1))
    )
  )
    throw new Error("Refusing to change a path outside worker build output.");
  return absolute;
}
async function removeOwned(path) {
  await rm(ownedPath(path), { recursive: true, force: true });
}
for (const path of [destination, staging, backup]) ownedPath(path);
try {
  await new Promise((accept, reject) => {
    const child = spawn(
      "dotnet",
      [
        "publish",
        resolve(nova, "../server/Vestra.Server.csproj"),
        "-c",
        "Release",
        "-r",
        "win-x64",
        "--self-contained",
        "true",
        "-p:PublishSingleFile=false",
        "-p:PublishTrimmed=false",
        "-p:DebugType=None",
        "-p:DebugSymbols=false",
        "-o",
        staging,
        "--nologo",
      ],
      { stdio: "inherit", windowsHide: true },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? accept()
        : reject(new Error(`Worker publish failed (${code}).`)),
    );
  });
  for (const file of [
    "Vestra.Server.exe",
    "Vestra.Server.dll",
    "coreclr.dll",
    "hostfxr.dll",
    "hostpolicy.dll",
  ])
    await stat(join(staging, file));
  const config = JSON.parse(
    await readFile(join(staging, "Vestra.Server.runtimeconfig.json"), "utf8"),
  );
  if (
    !config.runtimeOptions?.includedFrameworks?.length ||
    config.runtimeOptions?.frameworks
  )
    throw new Error("Publish output is not self-contained.");
  await writeFile(
    join(staging, "worker-manifest.json"),
    JSON.stringify(
      { rid: "win-x64", selfContained: true, protocol: 1 },
      null,
      2,
    ),
  );
  let moved = false;
  try {
    await rename(destination, backup);
    moved = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (moved) await rename(backup, destination);
    throw error;
  }
  if (moved) await removeOwned(backup);
  console.info("[publish-worker] self-contained win-x64 worker ready");
} finally {
  await removeOwned(staging);
}
