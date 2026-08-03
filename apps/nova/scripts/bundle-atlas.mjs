// @ts-check
import { cp, mkdir, readdir, readlink, rm, stat, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies the Atlas `standalone` build into Nova's resources so the packaged
 * desktop app can serve it locally.
 *
 * Next does NOT copy `.next/static` or `public` into `standalone` — that is a
 * documented gap. Skipping this step yields an app that boots but renders with
 * no CSS or client JS, so both are copied explicitly below.
 *
 * Every copy runs with `dereference: true`. pnpm's node_modules is a forest of
 * symlinks into the global store; recreating those would (a) fail on Windows
 * without Developer Mode and (b) produce a package that only works on this
 * machine. Dereferencing writes real files.
 */

const COPY_OPTIONS = { recursive: true, dereference: true };

/**
 * Paths that must never reach a distributable build.
 *
 * `.vestra` is the runtime data directory — watchlist, history, progress and
 * the library index. It lives inside the app directory in development and gets
 * swept into the standalone output, which would ship the developer's viewing
 * history to every user who installs the app.
 */
const EXCLUDED = new Set([".vestra", ".env", ".env.local", "tsconfig.json", "components.json"]);

/** @param {string} src */
function shouldCopy(src) {
  return !EXCLUDED.has(path.basename(src));
}

/**
 * Recreate pnpm's `node_modules` links as Windows directory junctions.
 *
 * pnpm stores every real package under `.pnpm/` and links to it. Copying those
 * links with `dereference` flattens a package to the top level and severs its
 * route back into the store, so `next` loses sight of its own `@swc/helpers`.
 *
 * Junctions are used rather than symlinks because Windows allows them without
 * elevation or Developer Mode. They must be absolute, so each link target is
 * re-resolved against the copied tree.
 *
 * @param {string} sourceDir  node_modules directory containing the links
 * @param {string} targetDir  where to recreate them
 * @param {string} sourceRoot standalone root, for relativising link targets
 * @param {string} targetRoot bundle root, for rebuilding absolute targets
 */
async function relinkModules(sourceDir, targetDir, sourceRoot, targetRoot) {
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    // Scoped packages (@next, @swc) are real directories holding more links.
    if (entry.isDirectory() && entry.name.startsWith("@")) {
      await mkdir(targetPath, { recursive: true });
      await relinkModules(sourcePath, targetPath, sourceRoot, targetRoot);
      continue;
    }

    if (!entry.isSymbolicLink()) continue;

    // Resolve the link against its own directory, then re-anchor it inside the
    // bundle so the junction points at the copied store, not the dev machine.
    const linkValue = await readlink(sourcePath);
    const resolved = path.resolve(sourceDir, linkValue);
    const withinBundle = path.join(targetRoot, path.relative(sourceRoot, resolved));

    await mkdir(path.dirname(targetPath), { recursive: true });
    await symlink(withinBundle, targetPath, "junction");
  }
}

const novaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(novaRoot, "../..");
const atlasRoot = path.join(repoRoot, "apps/atlas");

const standaloneRoot = path.join(atlasRoot, ".next/standalone");
const target = path.join(novaRoot, "resources/atlas");

/** Recursively locate `server.js`; its folder is the standalone app root. */
async function findServerDir(dir, depth = 0) {
  if (depth > 4) return null;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  if (entries.some((entry) => entry.isFile() && entry.name === "server.js")) {
    return dir;
  }

  for (const entry of entries) {
    // node_modules never contains the entry point we want.
    if (!entry.isDirectory() || entry.name === "node_modules") continue;

    const found = await findServerDir(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }

  return null;
}

async function exists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(standaloneRoot))) {
    console.error(
      "[bundle-atlas] .next/standalone not found.\n" +
        "Build Atlas first:  pnpm --filter @vestra/atlas build",
    );
    process.exit(1);
  }

  const serverDir = await findServerDir(standaloneRoot);
  if (!serverDir) {
    console.error("[bundle-atlas] Could not locate server.js inside .next/standalone.");
    process.exit(1);
  }

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });

  // The app itself (server.js, .next/server, package.json), minus developer
  // state and minus node_modules — the latter is a link farm rebuilt below.
  const appModules = path.join(serverDir, "node_modules");
  await cp(serverDir, target, {
    ...COPY_OPTIONS,
    filter: (src) => shouldCopy(src) && src !== appModules,
  });

  // The real packages. Dereferenced so the bundle holds files, not links into
  // this machine's pnpm store.
  const standaloneModules = path.join(standaloneRoot, "node_modules");
  if (await exists(standaloneModules)) {
    await cp(standaloneModules, path.join(target, "node_modules"), COPY_OPTIONS);
  }

  // Re-point the app's own dependencies into the copied store.
  await relinkModules(
    appModules,
    path.join(target, "node_modules"),
    standaloneRoot,
    target,
  );

  // The two directories Next leaves behind.
  const staticDir = path.join(atlasRoot, ".next/static");
  if (await exists(staticDir)) {
    await cp(staticDir, path.join(target, ".next/static"), COPY_OPTIONS);
  }

  const publicDir = path.join(atlasRoot, "public");
  if (await exists(publicDir)) {
    await cp(publicDir, path.join(target, "public"), COPY_OPTIONS);
  }

  console.info(`[bundle-atlas] Bundled Atlas into ${path.relative(repoRoot, target)}`);
}

await main();
