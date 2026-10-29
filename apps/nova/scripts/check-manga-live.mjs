import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const nova = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  root = resolve(nova, "../..");
const scratch = await mkdtemp(join(tmpdir(), "vestra-manga-probe-"));
let worker;
try {
  await build({
    entryPoints: [join(nova, "electron/csharp-worker.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(scratch, "worker.cjs"),
  });
  const { CSharpProviderWorker } = createRequire(import.meta.url)(
    join(scratch, "worker.cjs"),
  );
  worker = new CSharpProviderWorker(
    join(root, "apps/server/bin/Release/net10.0/Vestra.Server.dll"),
  );
  const report = {
    checkedAt: new Date().toISOString(),
    scope:
      "Manga search, chapters and page metadata only; no image download or reader playback",
    providers: [],
  };
  for (const [id, hosts] of [
    ["mangastash", ["mangastash.org"]],
    ["manganato", ["www.mangabats.com"]],
  ]) {
    const row = { id, query: "Solo", steps: [] };
    report.providers.push(row);
    let source;
    try {
      source = await readFile(
        join(root, `Seanime-Providers/src/manga/${id}/provider.js`),
        "utf8",
      );
    } catch (error) {
      row.status = "source-missing";
      continue;
    }
    row.sourceSha256 = createHash("sha256").update(source).digest("hex");
    let stage = "load";
    const start = Date.now();
    try {
      await worker.request({
        kind: "load",
        provider: { id, type: "manga-provider", source, hosts },
      });
      const call = (method, args) =>
        worker.request({ kind: "call", providerId: id, method, args });
      stage = "search";
      const results = await call("search", [{ query: row.query, year: 0 }]);
      row.steps.push({ stage, count: results.length });
      if (!results.length) {
        row.status = "no-results";
        continue;
      }
      stage = "chapters";
      const chapters = await call("findChapters", [results[0].id]);
      row.steps.push({ stage, count: chapters.length });
      if (!chapters.length) {
        row.status = "no-chapters";
        continue;
      }
      stage = "pages";
      const pages = await call("findChapterPages", [chapters[0].id]);
      row.steps.push({ stage, count: pages.length });
      row.status = pages.length ? "metadata-verified" : "no-pages";
      if (pages.length && process.argv.includes("--image")) {
        stage = "image";
        const image = await worker.request({
          kind: "image",
          request: {
            url: pages[0].url,
            method: "GET",
            headers: pages[0].headers ?? {},
          },
        });
        row.steps.push({
          stage,
          mimeType: image.mimeType,
          bytes: Buffer.from(image.data, "base64").length,
        });
        row.status = "image-fetched";
        report.scope =
          "Manga metadata and one image per provider; no bulk chapter download";
      }
    } catch (error) {
      row.steps.push({ stage, error: String(error.message).slice(0, 500) });
      row.status = "failed";
    } finally {
      row.elapsedMs = Date.now() - start;
      console.log(JSON.stringify(row));
    }
  }
  await writeFile(
    join(root, "docs/live-manga-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
} finally {
  worker?.stop();
  await rm(scratch, { recursive: true, force: true });
}
