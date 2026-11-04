import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  lstat,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
export const repository = "amabee/Foundry";
const lockName = "extensions.snapshot.json";
const allowedPath =
  /^extensions\/(?:README\.md|registry\.json|LICENSE(?:\.md)?|[a-z0-9-]+\/(?:README\.md|LICENSE(?:\.md)?|manifest\.json|index\.js|src\/[a-z0-9-]+\.js))$/;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function validateLock(lock) {
  if (
    lock?.schema !== 1 ||
    lock.repository !== repository ||
    !/^[0-9a-f]{40}$/.test(lock.revision) ||
    !Array.isArray(lock.files) ||
    lock.files.length < 1 ||
    lock.files.length > 256
  )
    throw Error("Invalid Foundry snapshot lock.");
  const seen = new Set();
  for (const file of lock.files) {
    if (
      !allowedPath.test(file.path) ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      seen.has(file.path)
    )
      throw Error("Invalid or duplicate snapshot path/hash.");
    seen.add(file.path);
  }
  return lock;
}
async function readLock(base) {
  if ((await lstat(join(base, lockName))).isSymbolicLink())
    throw Error("Snapshot lock must not be a symlink or junction.");
  return validateLock(JSON.parse(await readFile(join(base, lockName), "utf8")));
}
async function checkedPath(base, relative) {
  if (!allowedPath.test(relative))
    throw Error("Snapshot path is outside the extension directory.");
  const target = resolve(base, relative);
  if (!target.startsWith(resolve(base, "extensions") + sep))
    throw Error("Unsafe snapshot target.");
  let current = base;
  for (const part of relative.split("/")) {
    current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw Error("Snapshot paths must not contain symlinks or junctions.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return target;
}
async function localFiles(base, relative = "extensions") {
  const result = [];
  if ((await lstat(join(base, relative))).isSymbolicLink())
    throw Error("Snapshot directory must not be a symlink or junction.");
  for (const entry of await readdir(join(base, relative), {
    withFileTypes: true,
  })) {
    if (entry.isSymbolicLink())
      throw Error("Snapshot paths must not contain symlinks or junctions.");
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) result.push(...(await localFiles(base, path)));
    else if (entry.isFile()) result.push(path);
    else throw Error("Unsupported snapshot file type.");
  }
  return result.sort();
}
export async function verifySnapshot(base = root) {
  const lock = await readLock(base);
  const actual = await localFiles(base);
  const expected = lock.files.map((file) => file.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error(
      "Bundled extension inventory differs from the Foundry lock. Use extensions:sync.",
    );
  for (const file of lock.files) {
    if (
      digest(await readFile(await checkedPath(base, file.path))) !== file.sha256
    )
      throw Error(
        `Foundry snapshot changed: ${file.path}. Edit sources in Foundry, then update the pinned snapshot.`,
      );
  }
  return lock;
}
async function download(url) {
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(20000),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Vestra-Foundry-Snapshot",
    },
  });
  if (!response.ok)
    throw Error(`Foundry download failed: HTTP ${response.status}.`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 2 * 1024 * 1024)
      throw Error("Foundry file exceeds the 2 MiB limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function writeSnapshot(lock, files) {
  let old;
  try {
    old = await readLock(root);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  // Check every target before touching the current snapshot.
  for (const file of [...files, ...(old?.files ?? [])])
    await checkedPath(root, file.path);
  for (const file of files) {
    const target = await checkedPath(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
  for (const file of old?.files ?? []) {
    if (!lock.files.some((next) => next.path === file.path))
      await unlink(await checkedPath(root, file.path));
  }
  await writeFile(join(root, lockName), JSON.stringify(lock, null, 2) + "\n");
  await verifySnapshot();
}
async function syncSnapshot(revision) {
  if (
    execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        "extensions",
        lockName,
      ],
      { cwd: root, encoding: "utf8" },
    ).trim()
  )
    throw Error(
      "Commit or save local snapshot changes before syncing Foundry.",
    );
  let lock;
  if (revision) {
    if (!/^[0-9a-f]{40}$/.test(revision))
      throw Error("Use a complete reviewed Foundry commit SHA.");
    const tree = JSON.parse(
      (
        await download(
          `https://api.github.com/repos/${repository}/git/trees/${revision}?recursive=1`,
        )
      ).toString("utf8"),
    );
    if (tree.truncated || !Array.isArray(tree.tree))
      throw Error("Incomplete Foundry source inventory.");
    const paths = tree.tree
      .filter(
        (file) => file.type === "blob" && file.path.startsWith("extensions/"),
      )
      .map((file) => file.path)
      .sort();
    if (
      !paths.length ||
      paths.length > 256 ||
      paths.some((path) => !allowedPath.test(path))
    )
      throw Error("Unexpected Foundry snapshot file inventory.");
    lock = {
      schema: 1,
      repository,
      revision,
      files: paths.map((path) => ({ path, sha256: "" })),
    };
  } else {
    lock = await readLock(root);
  }
  const files = [];
  for (const file of lock.files) {
    const bytes = await download(
      `https://raw.githubusercontent.com/${repository}/${lock.revision}/${file.path}`,
    );
    const hash = digest(bytes);
    if (!revision && hash !== file.sha256)
      throw Error(`Foundry hash mismatch: ${file.path}`);
    files.push({ path: file.path, bytes });
    file.sha256 = hash;
  }
  await writeSnapshot(validateLock(lock), files);
  console.log(
    `Synced ${lock.files.length} files from Foundry ${lock.revision}. Review the lock and source diff before committing.`,
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [mode, revision] = process.argv.slice(2);
  if (!mode || mode === "--check") {
    const lock = await verifySnapshot();
    console.log(
      `Verified ${lock.files.length} Foundry snapshot files at ${lock.revision}.`,
    );
  } else if (mode === "--sync" || (mode === "--update" && revision)) {
    await syncSnapshot(mode === "--update" ? revision : undefined);
  } else throw Error("Use --check, --sync, or --update <reviewed-commit-sha>.");
}
