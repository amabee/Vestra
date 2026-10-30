import { extractStreamplay, streamplayEmbed } from "./streamplay";
import { resolveEpisodeServers } from "./episode-servers";
import { safeFetch } from "./safe-fetch";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";

import { createStreamSourceProvider } from "@vestra/extension-host";
import { app } from "electron";
import { z } from "zod";

import type { ManagedSource } from "./source-manager";
import { CSharpProviderSession } from "./csharp-worker";
import { createImagePool, type CSharpImagePool } from "./csharp-image-pool";
import { resolveWorkerTarget } from "./worker-target";
import { csharpMangaProgress } from "./csharp-manga-progress";
import {
  csharpMangaBookmarks,
  type MangaBookmarkRepository,
} from "./manga-bookmarks";
import { transpileProvider } from "./provider-transpile";
import { applyProviderCompatibility } from "./provider-compat";
import { createStreamSourceAdapter } from "./extension-providers";
import { getMangaService } from "./manga-ipc";
import {
  getAdapterRegistry,
  getStreamSourceRegistry,
  resolveDataDir,
} from "./services";

const configSchema = z.object({
  providers: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
        type: z
          .enum(["onlinestream-provider", "manga-provider"])
          .default("onlinestream-provider"),
        name: z.string().min(1).max(200),
        sourcePath: z.string().min(1),
        hosts: z.array(z.string().min(1).max(253)).max(32),
        preferences: z.record(z.string(), z.unknown()).default({}),
        compatibility: z.enum(["animesaturn-nested-player-v1"]).optional(),
        preferredServer: z.string().min(1).max(120).optional(),
      }),
    )
    .max(32),
});

interface SeanimeEpisode {
  id: string;
  number: number;
  title?: string;
  url: string;
  provider: string;
}

let worker: CSharpProviderSession | null = null;
let imagePool: CSharpImagePool | null = null;
let shuttingDown = false;
const mangaRegistrations = new Set<string>();
const registrations = new Map<
  string,
  { sourceId: string; adapterId: string }
>();

function workerTarget() {
  return resolveWorkerTarget({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    arch: process.arch,
    dllOverride: process.env.VESTRA_CSHARP_SERVER_DLL,
  });
}
function clientForSources(): CSharpProviderSession {
  if (shuttingDown) throw new Error("Source runtime is shutting down.");
  return (worker ??= new CSharpProviderSession(
    workerTarget(),
    resolve(resolveDataDir(), "csharp-provider-store"),
  ));
}
export function fetchCSharpImage(request: unknown): Promise<unknown> {
  if (shuttingDown) throw new Error("Image runtime is shutting down.");
  return (imagePool ??= createImagePool(workerTarget())).image(request);
}
export function getMangaBookmarks(): MangaBookmarkRepository {
  return {
    list: () => csharpMangaBookmarks(clientForSources()).list(),
    set: (entry, saved) =>
      csharpMangaBookmarks(clientForSources()).set(entry, saved),
  };
}

export async function activateCSharpSource(
  definition: ManagedSource,
): Promise<void> {
  const client = clientForSources();
  const id = `csharp-${definition.id}`;
  const source = applyProviderCompatibility(
    transpileProvider(definition.source, definition.filename),
    definition.compatibility,
  );
  await client.request({
    kind: "load",
    provider: {
      id,
      type: definition.type,
      source,
      hosts: definition.hosts,
      preferences: definition.preferences,
    },
  });
  const call = (method: string, args: unknown[], signal?: AbortSignal) =>
    client.request({ kind: "call", providerId: id, method, args }, signal);
  if (definition.type === "manga-provider") {
    getMangaService().register(
      id,
      definition.name,
      call,
      fetchCSharpImage,
      csharpMangaProgress(client, id),
    );
    mangaRegistrations.add(id);
    return;
  }
  const episodes = new Map<string, SeanimeEpisode>();
  const provider = createStreamSourceProvider({
    extensionId: id,
    name: definition.name,
    kinds: ["anime"],
    methods: ["search", "getEpisodes", "getStreams"],
    async call(method, args, signal) {
      if (method === "search") {
        const query = String(args[0]);
        return call(
          "search",
          [
            {
              query,
              dub: false,
              year: 0,
              media: {
                id: 0,
                romajiTitle: query,
                synonyms: [],
                status: "NOT_YET_RELEASED",
                format: "TV",
                episodeCount: -1,
                isAdult: false,
              },
            },
          ],
          signal,
        );
      }
      if (method === "getEpisodes") {
        const rows = (await call(
          "findEpisodes",
          [String(args[0])],
          signal,
        )) as SeanimeEpisode[];
        return rows.map((row) => {
          const key = randomUUID();
          if (episodes.size >= 5000)
            episodes.delete(episodes.keys().next().value!);
          episodes.set(key, row);
          return { ...row, id: key, animeId: String(args[0]) };
        });
      }
      if (method === "getStreams") {
        const episode = episodes.get(String(args[0]));
        if (!episode)
          throw new Error(
            "Load the episode list before resolving a C# provider stream.",
          );
        const settings = (await call("getSettings", [], signal)) as {
          episodeServers: string[];
        };
        return resolveEpisodeServers(
          settings.episodeServers,
          definition.preferredServer,
          async (server) => {
            try {
              return await call("findEpisodeServer", [episode, server], signal);
            } catch (error) {
              const embed = streamplayEmbed(error);
              if (!embed) throw error;
              return extractStreamplay(
                embed,
                server,
                episode.url ?? "",
                signal,
              );
            }
          },
          async (result) => {
            const videoSources = [];
            const failures = [];
            for (const video of result.videoSources) {
              signal?.throwIfAborted();
              if (video.type !== "hls") {
                videoSources.push(video);
                continue;
              }
              try {
                const response = await safeFetch({
                  url: video.url,
                  headers: { ...result.headers, ...video.headers },
                  maxBytes: 1048576,
                  timeoutMs: 7000,
                });
                if (response.status < 200 || response.status >= 300)
                  throw new Error(`Video manifest HTTP ${response.status}`);
                if (!response.body.trimStart().startsWith("#EXTM3U"))
                  throw new Error(
                    "The server returned a web page instead of an HLS video manifest.",
                  );
                videoSources.push(video);
              } catch (error) {
                failures.push(
                  error instanceof Error ? error.message : String(error),
                );
              }
            }
            if (!videoSources.length)
              throw new Error(
                failures.join(" ") ||
                  "This server returned no supported videos.",
              );
            return { ...result, videoSources };
          },
          signal,
        );
      }
      throw new Error(`Unsupported C# provider adapter method: ${method}`);
    },
    onWarning: (message) => console.warn(`[csharp-provider:${id}] ${message}`),
  });
  const adapter = createStreamSourceAdapter(provider, () => {
    const registry = getStreamSourceRegistry();
    return (
      registry.get(provider.id) === provider && registry.isEnabled(provider.id)
    );
  });
  getStreamSourceRegistry().register(provider);
  try {
    getAdapterRegistry().register(adapter);
  } catch (error) {
    getStreamSourceRegistry().unregister(provider.id);
    throw error;
  }
  registrations.set(id, { sourceId: provider.id, adapterId: adapter.id });
  console.info(`[nova] loaded C# provider ${definition.name}`);
}

export async function deactivateCSharpSource(sourceId: string): Promise<void> {
  const id = `csharp-${sourceId}`;
  getMangaService().unregister(id);
  mangaRegistrations.delete(id);
  const registration = registrations.get(id);
  if (registration) {
    getStreamSourceRegistry().unregister(registration.sourceId);
    getAdapterRegistry().unregister(registration.adapterId);
    registrations.delete(id);
  }
  worker?.forget(id);
  if (worker) await worker.request({ kind: "unload", providerId: id });
}

export async function checkCSharpSource(sourceId: string): Promise<unknown> {
  return clientForSources().request({
    kind: "call",
    providerId: `csharp-${sourceId}`,
    method: "getSettings",
    args: [],
  });
}
export async function downloadSourceArtifact(url: string): Promise<Uint8Array> {
  const result = z
    .object({
      data: z
        .string()
        .max(2796204)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/),
    })
    .parse(await clientForSources().request({ kind: "download", url }));
  return Buffer.from(result.data, "base64");
}

/** Legacy config is a first-run seed. Managed copies are independent of these paths. */
export async function readLegacyCSharpSources(): Promise<ManagedSource[]> {
  const configPath = process.env.VESTRA_CSHARP_PROVIDERS;
  if (!configPath || app.isPackaged) return [];
  const absoluteConfigPath = resolve(configPath);
  if ((await stat(absoluteConfigPath)).size > 65_536)
    throw new Error("C# provider configuration exceeds 64 KiB.");
  const config = configSchema.parse(
    JSON.parse(await readFile(absoluteConfigPath, "utf8")),
  );
  if (
    new Set(config.providers.map((p) => p.id)).size !== config.providers.length
  )
    throw new Error("C# provider IDs must be unique.");
  const result: ManagedSource[] = [];
  for (const definition of config.providers) {
    const sourcePath = resolve(
      dirname(absoluteConfigPath),
      definition.sourcePath,
    );
    if ((await stat(sourcePath)).size > 1_048_576)
      throw new Error(`Provider ${definition.id} exceeds 1 MiB.`);
    result.push({
      ...definition,
      enabled: true,
      history: [],
      filename: basename(sourcePath),
      source: await readFile(sourcePath, "utf8"),
    });
  }
  return result;
}

export function stopCSharpProviders(): void {
  shuttingDown = true;
  for (const id of mangaRegistrations) getMangaService().unregister(id);
  mangaRegistrations.clear();
  for (const entry of registrations.values()) {
    getStreamSourceRegistry().unregister(entry.sourceId);
    getAdapterRegistry().unregister(entry.adapterId);
  }
  registrations.clear();
  worker?.stop();
  worker = null;
  imagePool?.stop();
  imagePool = null;
}
