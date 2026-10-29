import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";

import { createStreamSourceProvider } from "@vestra/extension-host";
import { app } from "electron";
import { z } from "zod";

import { CSharpProviderSession } from "./csharp-worker";
import { transpileProvider } from "./provider-transpile";
import {
  applyProviderCompatibility,
  chooseEpisodeServer,
} from "./provider-compat";
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
const registrations: { sourceId: string; adapterId: string }[] = [];

/** Explicit development opt-in while the C# binding surface is incomplete. */
export async function loadCSharpProviders(): Promise<void> {
  const configPath = process.env.VESTRA_CSHARP_PROVIDERS;
  if (!configPath || app.isPackaged) return;
  if (worker) throw new Error("C# providers are already initialized.");
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
  const dllPath =
    process.env.VESTRA_CSHARP_SERVER_DLL ??
    resolve(
      app.getAppPath(),
      "../server/bin/Release/net10.0/Vestra.Server.dll",
    );
  worker = new CSharpProviderSession(
    dllPath,
    resolve(resolveDataDir(), "csharp-provider-store"),
  );
  const client = worker;
  try {
    for (const definition of config.providers) {
      const id = `csharp-${definition.id}`;
      const sourcePath = resolve(
        dirname(absoluteConfigPath),
        definition.sourcePath,
      );
      if ((await stat(sourcePath)).size > 1_048_576)
        throw new Error(`Provider ${id} exceeds 1 MiB.`);
      const source = applyProviderCompatibility(
        transpileProvider(await readFile(sourcePath, "utf8"), sourcePath),
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
        getMangaService().register(id, definition.name, call, (request) =>
          client.request({ kind: "image", request }),
        );
        continue;
      }
      const episodes = new Map<string, SeanimeEpisode>();
      const provider = createStreamSourceProvider({
        extensionId: id,
        name: `${definition.name} (C# preview)`,
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
            // Start with the first advertised server. Mirror selection remains a
            // separate parity task; do not multiply network calls by default.
            const raw = (await call(
              "findEpisodeServer",
              [
                episode,
                chooseEpisodeServer(
                  settings.episodeServers,
                  definition.preferredServer,
                ),
              ],
              signal,
            )) as {
              server: string;
              headers?: Record<string, string>;
              videoSources: { type: string; url: string; quality?: string }[];
            };
            return [
              {
                ...raw,
                videoSources: raw.videoSources.flatMap((video) => {
                  const type =
                    video.type === "m3u8" || video.type === "hls"
                      ? "hls"
                      : video.type === "mp4"
                        ? "mp4"
                        : null;
                  return type
                    ? [{ ...video, type, quality: video.quality ?? "auto" }]
                    : [];
                }),
              },
            ];
          }
          throw new Error(`Unsupported C# provider adapter method: ${method}`);
        },
        onWarning: (message) =>
          console.warn(`[csharp-provider:${id}] ${message}`),
      });
      const adapter = createStreamSourceAdapter(provider);
      getStreamSourceRegistry().register(provider);
      getAdapterRegistry().register(adapter);
      registrations.push({ sourceId: provider.id, adapterId: adapter.id });
      console.info(`[nova] loaded C# provider ${definition.name}`);
    }
  } catch (error) {
    stopCSharpProviders();
    throw error;
  }
}

export function stopCSharpProviders(): void {
  for (const source of getMangaService().list())
    getMangaService().unregister(source.id);
  for (const entry of registrations.splice(0)) {
    getStreamSourceRegistry().unregister(entry.sourceId);
    getAdapterRegistry().unregister(entry.adapterId);
  }
  worker?.stop();
  worker = null;
}
