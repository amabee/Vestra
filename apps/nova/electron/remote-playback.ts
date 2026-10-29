import { createHash, randomUUID } from "node:crypto";
import type { StreamResult } from "@vestra/extension-host";
import { z } from "zod";

const remoteSchema = z.object({
  url: z
    .string()
    .url()
    .max(4096)
    .refine(
      (v) =>
        new URL(v).protocol === "https:" &&
        !new URL(v).username &&
        !new URL(v).password,
    ),
  headers: z
    .record(
      z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,100}$/),
      z
        .string()
        .max(4096)
        .refine((v) => !/[\r\n\0]/.test(v)),
    )
    .refine((v) => Object.keys(v).length <= 32),
  subtitles: z
    .array(
      z.object({
        url: z
          .string()
          .url()
          .max(4096)
          .refine((v) => new URL(v).protocol === "https:"),
        language: z.string().max(100),
        isDefault: z.boolean().optional(),
      }),
    )
    .max(50),
});
export type RemotePlayback = z.infer<typeof remoteSchema>;
export interface RemoteVariant {
  key: string;
  label: string;
  playback: RemotePlayback;
}
export interface RemoteQuality {
  locator: string;
  label: string;
}
export function streamVariants(
  results: readonly StreamResult[],
): RemoteVariant[] {
  const variants: RemoteVariant[] = [];
  const occurrences = new Map<string, number>();
  for (const result of results)
    for (const video of result.videoSources) {
      const base = JSON.stringify([result.server, video.quality, video.type]);
      const occurrence = occurrences.get(base) ?? 0;
      occurrences.set(base, occurrence + 1);
      if (variants.length < 50)
        variants.push({
          key: createHash("sha256")
            .update(
              JSON.stringify([
                result.server,
                video.quality,
                video.type,
                occurrence,
              ]),
            )
            .digest("hex"),
          label: `${video.quality} · ${result.server} · ${video.type.toUpperCase()}`,
          playback: {
            url: video.url,
            headers: { ...result.headers, ...video.headers },
            subtitles: video.subtitles ?? [],
          },
        });
    }
  return variants;
}
type Entry = {
  resolve: () => Promise<RemoteVariant[]>;
  selected?: string;
  choices: Map<string, string>;
};
const entries = new Map<string, Entry>();
function register(entry: Entry): string {
  const locator = `vestra-stream://${randomUUID()}`;
  if (entries.size >= 2000) entries.delete(entries.keys().next().value!);
  entries.set(locator, entry);
  return locator;
}
const variantSchema = z.object({
  key: z.string().min(1).max(512),
  label: z.string().min(1).max(240),
  playback: remoteSchema,
});
async function variants(entry: Entry): Promise<RemoteVariant[]> {
  const rows = z
    .array(variantSchema)
    .min(1)
    .max(50)
    .parse(await entry.resolve());
  if (new Set(rows.map((row) => row.key)).size !== rows.length)
    throw new Error("Stream rendition identifiers must be unique.");
  return rows;
}
/** Renderer receives an opaque handle; guest URLs stay in main. */
export function registerRemotePlayback(input: RemotePlayback): string {
  const playback = remoteSchema.parse(input);
  return register({
    resolve: async () => [{ key: "default", label: "Auto", playback }],
    choices: new Map(),
  });
}
export function registerDeferredPlayback(
  resolve: () => Promise<RemotePlayback>,
): string {
  return registerDeferredVariants(async () => [
    { key: "default", label: "Auto", playback: await resolve() },
  ]);
}
export function registerDeferredVariants(
  resolve: () => Promise<RemoteVariant[]>,
): string {
  return register({ resolve, choices: new Map() });
}
export async function remoteQualities(
  locator: string,
): Promise<RemoteQuality[]> {
  const entry = entries.get(locator);
  if (!entry) throw new Error("Stream expired. Resolve this episode again.");
  const rows = await variants(entry);
  return rows.map((row) => {
    let selected = entry.choices.get(row.key);
    if (!selected || !entries.has(selected)) {
      selected = register({
        resolve: entry.resolve,
        choices: entry.choices,
        selected: row.key,
      });
      entry.choices.set(row.key, selected);
    }
    return { locator: selected, label: row.label };
  });
}
export async function resolveRemotePlayback(
  locator: string,
): Promise<RemotePlayback> {
  const entry = entries.get(locator);
  if (!entry) throw new Error("Stream expired. Resolve this episode again.");
  const rows = await variants(entry);
  const selected = entry.selected
    ? rows.find((row) => row.key === entry.selected)
    : rows[0];
  if (!selected)
    throw new Error(
      "The selected stream quality is no longer available. Choose another quality.",
    );
  return selected.playback;
}

export function remoteLoadOptions(remote?: RemotePlayback): {
  headers: string[];
  subtitles: string[];
} {
  return {
    headers: Object.entries(remote?.headers ?? {}).map(
      ([key, value]) => `${key}: ${value}`,
    ),
    subtitles: [...(remote?.subtitles ?? [])]
      .sort(
        (a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)),
      )
      .map((s) => s.url),
  };
}
