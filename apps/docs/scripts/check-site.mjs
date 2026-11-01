import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const file = join(directory, name);
    return statSync(file).isDirectory() ? files(file) : [file];
  });
}
let checked = 0;
for (const file of files(dist).filter((file) => file.endsWith(".html"))) {
  const html = readFileSync(file, "utf8");
  for (const [, href] of html.matchAll(/href="(\/[^"\s]*)"/g)) {
    if (href.startsWith("//")) continue;
    const url = new URL(href, "http://docs.local");
    const target = join(
      dist,
      decodeURIComponent(url.pathname),
      url.pathname.endsWith("/") ? "index.html" : "",
    );
    assert.ok(existsSync(target), `${file}: broken internal link ${href}`);
    if (url.hash && target.endsWith(".html"))
      assert.ok(
        readFileSync(target, "utf8").includes(
          `id="${decodeURIComponent(url.hash.slice(1))}"`,
        ),
        `Missing heading ${href}`,
      );
    checked++;
  }
}
console.log(`PASS ${checked} built local links and heading anchors`);
const executablePath =
  process.env.CHROME_PATH ??
  (process.platform === "win32"
    ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
    : undefined);
if (!executablePath)
  throw Error(
    "Set CHROME_PATH to a Chrome or Edge executable for hidden browser checks.",
  );
let server;
let base = process.env.DOCS_URL;
if (!base) {
  const mime = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
  };
  server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://docs.local").pathname,
      );
      const file = resolve(
        dist,
        "." + pathname,
        pathname.endsWith("/") ? "index.html" : "",
      );
      if (
        !file.startsWith(dist + sep) ||
        !existsSync(file) ||
        !statSync(file).isFile()
      ) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      });
      response.end(readFileSync(file));
    } catch {
      response.writeHead(400);
      response.end("Invalid request");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  protocolTimeout: 15000,
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  for (const width of [320, 375, 1280, 1920]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(base, { waitUntil: "networkidle0" });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `Homepage overflow ${width}`,
    );
    assert.ok(await page.$('a[href="/extensions/quickstart/"]'));
  }
  console.log("PASS responsive homepage widths");
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(base + "/extensions/quickstart/", {
    waitUntil: "networkidle0",
  });
  assert.match(
    await page.$eval(".prose h1", (e) => e.textContent),
    /Create your first/,
  );
  assert.ok(await page.$('.prose a[href="/extensions/manga/"]'));
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__copied = text;
        },
      },
    });
  });
  await page.click(".copy-code");
  assert.match(await page.evaluate(() => window.__copied), /Copy-Item/);
  await page.setViewport({ width: 375, height: 900 });
  await page.waitForFunction(
    () => !document.querySelector(".sidebar details").open,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.click(".sidebar summary");
  assert.equal(await page.$eval(".sidebar details", (e) => e.open), true);
  console.log("PASS quickstart, copy and mobile menu");
  await page.goto(base + "/search/?q=getStreams", {
    waitUntil: "networkidle0",
  });
  assert.ok((await page.$$(".search-results li:not([hidden])")).length > 0);
  await page.$eval("#doc-search", (input) => {
    input.value = "unfindable-vestra-test";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.match(
    await page.$eval("#search-status", (e) => e.textContent),
    /No matching pages/,
  );
  assert.ok(page.url().includes("unfindable-vestra-test"));
  await page.goto(base + "/reference/manifest/", { waitUntil: "networkidle0" });
  await page.keyboard.press("/");
  await page.waitForFunction(() => location.pathname === "/search/");
  await page.waitForFunction(() => document.activeElement?.id === "doc-search");
  console.log("PASS search and keyboard navigation");
  const noScript = await browser.newPage();
  await noScript.setJavaScriptEnabled(false);
  await noScript.goto(base + "/extensions/quickstart/", {
    waitUntil: "networkidle0",
  });
  assert.match(
    await noScript.$eval(".prose", (e) => e.textContent),
    /getStreams/,
  );
  assert.ok(await noScript.$('.sidebar a[href="/reference/manifest/"]'));
  assert.deepEqual(errors, []);
  await noScript.close();
  await page.bringToFront();
  if (process.env.DOCS_SCREENSHOTS) {
    mkdirSync(process.env.DOCS_SCREENSHOTS, { recursive: true });
    for (const width of [1440, 375]) {
      await page.setViewport({ width, height: 900 });
      await page.goto(base + "/extensions/quickstart/", {
        waitUntil: "networkidle0",
      });
      await page.screenshot({
        path: join(process.env.DOCS_SCREENSHOTS, `quickstart-${width}.png`),
        fullPage: false,
      });
    }
  }
  console.log(
    "PASS responsive docs, canonical links, isolated code-copy fixture, mobile menu, local search, keyboard shortcut and no-JavaScript reading",
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await Promise.race([
    browser.close(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (browser.process()?.exitCode === null) browser.process().kill();
  if (server) await new Promise((resolve) => server.close(resolve));
}
