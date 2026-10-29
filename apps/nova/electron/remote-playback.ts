import { randomUUID } from "node:crypto";
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
const entries = new Map<
  string,
  RemotePlayback | (() => Promise<RemotePlayback>)
>();

/** Renderer receives an opaque handle; only main-process provider results register URLs. */
export function registerRemotePlayback(input: RemotePlayback): string {
  const value = remoteSchema.parse(input);
  const locator = `vestra-stream://${randomUUID()}`;
  if (entries.size >= 2000) entries.delete(entries.keys().next().value!);
  entries.set(locator, value);
  return locator;
}
export function registerDeferredPlayback(
  resolve: () => Promise<RemotePlayback>,
): string {
  const locator = `vestra-stream://${randomUUID()}`;
  if (entries.size >= 2000) entries.delete(entries.keys().next().value!);
  entries.set(locator, resolve);
  return locator;
}
export async function resolveRemotePlayback(
  locator: string,
): Promise<RemotePlayback> {
  const entry = entries.get(locator);
  if (!entry) throw new Error("Stream expired. Resolve this episode again.");
  // Resolve again on replay; signed CDN URLs can expire between plays.
  return remoteSchema.parse(
    typeof entry === "function" ? await entry() : entry,
  );
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
