import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { MemoryDriver } from "@vestra/storage";
import { describe, expect, it, vi } from "vitest";
import {
  MangaService,
  type ReadingProgressRepository,
} from "../../../apps/nova/electron/manga-service";
import { MangaTitleResolver } from "../../../apps/nova/electron/manga-title-resolver";
import { MangaExtensionRegistry } from "../../../apps/nova/electron/manga-extension";
import {
  prepareUnpacked,
  completeUnpacked,
} from "../../../apps/nova/electron/extension-unpacked";
import { createQuickJSRuntime } from "./runtime/quickjs";
import {
  assertMangaSourceMethods,
  mangaPagesSchema,
  mangaChaptersSchema,
} from "./manga-types";
import { parseManifest } from "./manifest";
import { saveInstalled, listInstalled, readSource } from "./store";
import type { InstalledExtension } from "./install";

const folder = fileURLToPath(
  new URL("../examples/manga-source-template/", import.meta.url),
);
const methods = ["search", "getChapters", "getPages"];
const progress = (): ReadingProgressRepository => ({
  read: async () => null,
  save: async () => {},
  recent: async () => ({ entries: [], unreadable: 0, truncated: false }),
  import: async (_book, value) => value,
});
async function record(): Promise<InstalledExtension> {
  const plan = await prepareUnpacked(folder);
  return (await completeUnpacked(plan, ["network"])).record;
}

describe("native manga SDK", () => {
  it("installs the example and runs library → chapters → images → progress through real QuickJS", async () => {
    const driver = new MemoryDriver();
    const plan = await prepareUnpacked(folder);
    expect(plan.warnings.join(" ")).not.toContain("no content kinds");
    const installed = await completeUnpacked(plan, ["network"]);
    expect(installed.record.type).toBe("manga-provider");
    await saveInstalled(driver, installed.record, installed.source);
    const [saved] = await listInstalled(driver);
    assert(saved);
    expect(saved.manifest.role).toBe("manga-source");
    const runtime = createQuickJSRuntime();
    const guest = await runtime.load({
      extensionId: saved.id,
      source: (await readSource(driver, saved))!,
      bridge: { extensionId: saved.id, log() {} },
    });
    const repository = progress();
    repository.save = vi.fn(async () => {});
    const repositories = vi.fn(() => repository);
    const image = vi.fn(async () => ({ mimeType: "image/png", data: "AAE=" }));
    const service = new MangaService(driver);
    const registry = new MangaExtensionRegistry(
      service,
      (_id, method, args) =>
        guest.call(method, args, AbortSignal.timeout(5000)),
      image,
      repositories,
      () => true,
    );
    try {
      const exported = await guest.listMethods(AbortSignal.timeout(5000));
      assertMangaSourceMethods(saved.manifest.role, exported);
      registry.attach(saved, exported);
      const id = `ext-${saved.id}`;
      expect(service.list()).toEqual([{ id, name: saved.name }]);
      const [book] = await service.search(id, "example");
      assert(book);
      expect(book).toMatchObject({
        id: "example-book",
        title: "Example Manga",
      });
      expect(book.cover).not.toContain("https:");
      expect(await service.image(book.cover!)).toBe(
        "data:image/png;base64,AAE=",
      );
      const resolver = new MangaTitleResolver(driver, service, async () => ({
        id: 123,
        title: "Example Manga",
        titles: [],
        genres: [],
        origin: null,
        status: null,
        score: null,
        description: null,
        chapters: null,
        volumes: null,
        year: null,
      }));
      expect((await resolver.catalogue(id, 123))?.id).toBe(book.id);
      const [chapter] = await service.chapters(id, book.id);
      assert(chapter);
      expect(chapter.chapter).toBe("1");
      const pages = await service.pages(id, book.id, chapter.id);
      expect(pages).toHaveLength(2);
      expect(JSON.stringify(pages)).not.toContain("example.org");
      await service.image(pages[0]!.handle);
      expect(image).toHaveBeenLastCalledWith({
        url: "https://images.example.org/page-1.png",
        headers: {},
        method: "GET",
      });
      await service.save(id, book.id, chapter.id, 1);
      expect(repositories).toHaveBeenCalledWith(id);
      expect(repository.save).toHaveBeenCalledWith(
        book.id,
        chapter.id,
        1,
        2,
        book.title,
        { url: "https://images.example.org/cover.png", headers: {} },
      );
      registry.detach(saved.id);
      expect(service.list()).toEqual([]);
      await expect(service.image(pages[0]!.handle)).rejects.toThrow(/expired/);
      registry.attach(saved, exported);
      expect(service.list()).toHaveLength(1);
    } finally {
      registry.detach(saved.id);
      guest.dispose();
      runtime.disposeAll();
    }
  });

  it("rejects undeclared image hosts and missing network permission before download", async () => {
    for (const grant of [
      { granted: [], allowedHosts: ["images.example.org"] },
      { granted: ["network"], allowedHosts: ["other.example.org"] },
    ]) {
      const saved = await record();
      saved.grant = { ...saved.grant, ...grant } as InstalledExtension["grant"];
      const image = vi.fn();
      const service = new MangaService(new MemoryDriver());
      const registry = new MangaExtensionRegistry(
        service,
        async () => [
          {
            id: "book",
            title: "Title",
            cover: { url: "https://images.example.org/cover.png" },
          },
        ],
        image,
        progress,
        () => true,
      );
      registry.attach(saved, methods);
      await expect(service.search(`ext-${saved.id}`, "x")).rejects.toThrow(
        /not granted/,
      );
      expect(image).not.toHaveBeenCalled();
      registry.detach(saved.id);
    }
  });

  it("rejects stale page metadata when a source is replaced during loading", async () => {
    const saved = await record();
    let release!: (value: unknown) => void;
    const service = new MangaService(new MemoryDriver());
    const call = async (_id: string, method: string) => {
      if (method === "search") return [{ id: "book", title: "Title" }];
      if (method === "getChapters")
        return [{ id: "chapter", title: "One", number: "1", index: 0 }];
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const registry = new MangaExtensionRegistry(
      service,
      call,
      vi.fn(),
      progress,
      () => true,
    );
    registry.attach(saved, methods);
    const id = `ext-${saved.id}`;
    await service.search(id, "x");
    await service.chapters(id, "book");
    const pending = service.pages(id, "book", "chapter");
    const rejected = expect(pending).rejects.toThrow(/changed|disabled/);
    registry.attach(saved, methods);
    release([{ url: "https://images.example.org/old.png", index: 0 }]);
    await rejected;
    registry.detach(saved.id);
  });

  it("validates role, required methods, URL schemes and ordering identities", () => {
    const base = {
      id: "example",
      name: "Example",
      version: "1",
      main: "index.js",
      sdkVersion: "1.1.0",
      role: "manga-source",
    };
    expect(parseManifest(base).manifest?.role).toBe("manga-source");
    expect(parseManifest({ ...base, kinds: ["anime"] }).manifest).toBeNull();
    expect(() => assertMangaSourceMethods("manga-source", ["search"])).toThrow(
      /getChapters/,
    );
    expect(
      mangaPagesSchema.safeParse([
        { url: "http://images.example.org/x", index: 0 },
      ]).success,
    ).toBe(false);
    expect(
      mangaPagesSchema.safeParse([{ url: "not a URL", index: 0 }]).success,
    ).toBe(false);

    expect(
      mangaPagesSchema.safeParse([
        { url: "https://user:pass@images.example.org/x", index: 0 },
      ]).success,
    ).toBe(false);
    expect(
      mangaPagesSchema.safeParse(
        [0, 0].map((index) => ({ url: "https://images.example.org/x", index })),
      ).success,
    ).toBe(false);
    expect(
      mangaChaptersSchema.safeParse(
        [0, 1].map((index) => ({
          id: "duplicate",
          number: "1",
          title: "Chapter",
          index,
        })),
      ).success,
    ).toBe(false);
  });
});
