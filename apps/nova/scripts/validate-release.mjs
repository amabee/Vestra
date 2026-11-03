import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const updaterRequire = createRequire(
  require.resolve("electron-updater/package.json"),
);
const { load } = updaterRequire("js-yaml");
const { valid, prerelease } = updaterRequire("semver");

export async function validateRelease(
  folder = join(nova, "release"),
  version,
  tag,
  expectedPublisher,
) {
  const manifest = JSON.parse(
    await readFile(join(nova, "package.json"), "utf8"),
  );
  version ??= manifest.version;
  if (!valid(version) || prerelease(version))
    throw Error("The stable updater requires a stable semantic version.");
  if (tag && tag !== `v${version}`)
    throw Error("Release tag must match the Nova package version.");
  const feed = load(await readFile(join(folder, "latest.yml"), "utf8"));
  if (feed?.version !== version)
    throw Error("Update feed version does not match the app version.");
  if (!Array.isArray(feed.files) || feed.files.length !== 1)
    throw Error("Expected exactly one Windows x64 installer in latest.yml.");
  const entry = feed.files[0];
  const expected = `Vestra-Nova-${version}-Setup-x64.exe`;
  if (entry.url !== expected || basename(entry.url) !== entry.url)
    throw Error("Update feed has an unexpected installer path.");
  const installer = join(folder, expected),
    size = (await stat(installer)).size;
  if (size <= 0 || entry.size !== size)
    throw Error("Installer size does not match latest.yml.");
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(installer)) hash.update(chunk);
  const digest = hash.digest("base64");
  if (
    entry.sha512 !== digest ||
    feed.sha512 !== digest ||
    feed.path !== expected
  )
    throw Error("Installer SHA-512 does not match latest.yml.");
  const blockmap = expected + ".blockmap";
  if ((await stat(join(folder, blockmap))).size <= 0)
    throw Error("Installer blockmap is empty.");
  const config = load(
    await readFile(
      join(folder, "win-unpacked/resources/app-update.yml"),
      "utf8",
    ),
  );
  if (
    config.provider !== "github" ||
    config.owner !== "amabee" ||
    config.repo !== "Vestra"
  )
    throw Error("Packaged app update feed is incorrect.");
  if (expectedPublisher) {
    const publishers = Array.isArray(config.publisherName)
      ? config.publisherName
      : [config.publisherName];
    if (
      config.verifyUpdateCodeSignature === false ||
      !publishers.includes(expectedPublisher)
    )
      throw Error(
        "The packaged updater must verify the configured Windows publisher.",
      );
  }
  return {
    version,
    installer: expected,
    blockmap,
    metadata: "latest.yml",
    sha512: digest,
    size,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    JSON.stringify(
      await validateRelease(
        undefined,
        undefined,
        process.env.GITHUB_REF_NAME,
        process.env.VESTRA_WINDOWS_PUBLISHER,
      ),
      null,
      2,
    ),
  );
}
