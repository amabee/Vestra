// @ts-check
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unpack } from "7zip-min";

/**
 * Fetches the mpv binary that gets bundled with Nova.
 *
 * mpv is a separate GPL program. It is not linked into the application and its
 * source is not part of this repository, so it is downloaded from the upstream
 * Windows build at package time rather than committed. That keeps the two
 * programs distinct — which is what allows Nova to ship under its own licence —
 * and keeps a 112MB binary out of git history.
 *
 * Redistributing it carries an obligation: the exact upstream release is
 * recorded in `mpv-build.json` beside the binary so the corresponding source
 * can always be identified.
 *
 * Usage:
 *   node scripts/fetch-mpv.mjs           # skip if already present
 *   node scripts/fetch-mpv.mjs --force   # re-download
 */

const novaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = path.join(novaRoot, "vendor", "mpv");
const binaryPath = path.join(vendorDir, "mpv.exe");
const metaPath = path.join(vendorDir, "mpv-build.json");

const RELEASES = "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest";

const force = process.argv.includes("--force");

if (existsSync(binaryPath) && !force) {
  const meta = JSON.parse(await readFile(metaPath, "utf8").catch(() => "{}"));
  console.log(`mpv already present (${meta.tag ?? "unknown build"}). Use --force to refresh.`);
  process.exit(0);
}

console.log("Looking up the latest mpv Windows build…");

const release = await fetchJson(RELEASES);

// The plain x86_64 build. `v3` targets newer CPUs only and `dev`/`debug` carry
// headers and symbols that a shipped player has no use for.
const asset = release.assets.find(
  (/** @type {{ name: string }} */ candidate) =>
    /^mpv-x86_64-\d{8}-git-[0-9a-f]+\.7z$/.test(candidate.name),
);

if (!asset) {
  console.error("No suitable mpv asset found in the latest release.");
  process.exit(1);
}

console.log(`Downloading ${asset.name} (${(asset.size / 1048576).toFixed(1)} MB)…`);

const response = await fetch(asset.browser_download_url);
if (!response.ok) {
  console.error(`Download failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const archive = Buffer.from(await response.arrayBuffer());
const sha256 = createHash("sha256").update(archive).digest("hex");

await rm(vendorDir, { recursive: true, force: true });
await mkdir(vendorDir, { recursive: true });

const archivePath = path.join(vendorDir, "mpv.7z");
await writeFile(archivePath, archive);

console.log("Extracting…");

const extractDir = path.join(vendorDir, "extracted");
await new Promise((resolve, reject) => {
  unpack(archivePath, extractDir, (error) => (error ? reject(error) : resolve(undefined)));
});

// Only the executable ships. The build also carries a PDF manual, an icon, a
// D3D9 compiler DLL that the d3d11 renderer does not use, and shell installer
// scripts — none of which Nova invokes. Verified: mpv.exe alone plays with
// --vo=gpu.
const extractedBinary = path.join(extractDir, "mpv.exe");
if (!existsSync(extractedBinary)) {
  console.error("mpv.exe was not found in the archive.");
  process.exit(1);
}

await writeFile(binaryPath, await readFile(extractedBinary));

await writeFile(
  metaPath,
  `${JSON.stringify(
    {
      tag: release.tag_name,
      asset: asset.name,
      archiveSha256: sha256,
      sourceRepository: "https://github.com/mpv-player/mpv",
      buildScripts: "https://github.com/shinchiro/mpv-winbuild-cmake",
      releaseUrl: release.html_url,
      licence: "GPL-2.0-or-later",
      fetchedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  path.join(vendorDir, "NOTICE.txt"),
  [
    "mpv",
    "====",
    "",
    `Build:   ${asset.name}`,
    `Release: ${release.html_url}`,
    "Licence: GPL-2.0-or-later",
    "",
    "mpv is a separate program, distributed alongside Vestra rather than linked",
    "into it. Vestra communicates with it over a local socket only.",
    "",
    "Source code for this build is available from:",
    "  https://github.com/mpv-player/mpv",
    "and the scripts used to produce the Windows binary from:",
    "  https://github.com/shinchiro/mpv-winbuild-cmake",
    "",
    "The full GPL text is available at https://www.gnu.org/licenses/gpl-2.0.html",
    "",
  ].join("\n"),
);

await rm(archivePath, { force: true });
await rm(extractDir, { recursive: true, force: true });

const { size } = await import("node:fs").then((fs) => fs.promises.stat(binaryPath));
console.log(`mpv ${release.tag_name} ready (${(size / 1048576).toFixed(1)} MB on disk).`);

/** @param {string} url */
async function fetchJson(url) {
  const result = await fetch(url, { headers: { "User-Agent": "vestra-nova-build" } });
  if (!result.ok) {
    console.error(`GitHub request failed: ${result.status} ${result.statusText}`);
    process.exit(1);
  }
  return result.json();
}
