import { z } from "zod";
import { mediaKey, mediaRefSchema } from "@vestra/types";

export const continueTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("anime"),
    ref: mediaRefSchema.extend({ kind: z.literal("anime") }),
  }),
  z.object({
    kind: z.literal("manga"),
    source: z.string().min(1).max(120),
    book: z.string().min(1).max(4096),
  }),
]);
export type ContinueTarget = z.infer<typeof continueTargetSchema>;
export type ContinueDismissals = Record<string, number>;
export const continueDismissalsSchema = z.record(
  z.string().max(8192),
  z.number().finite().nonnegative(),
);
export function continueKey(target: ContinueTarget): string {
  return target.kind === "anime"
    ? JSON.stringify(["anime", mediaKey(target.ref)])
    : JSON.stringify(["manga", target.source, target.book]);
}
export function hiddenFromContinue(
  target: ContinueTarget,
  activity: number,
  dismissed: ContinueDismissals,
): boolean {
  const cutoff = dismissed[continueKey(target)];
  return cutoff !== undefined && activity <= cutoff;
}
