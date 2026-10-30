import { z } from "zod";
import { mediaItemSchema } from "@vestra/types";

export const playlistItemSchema = z.object({
  item: mediaItemSchema.refine(
    (item) => item.kind === "anime",
    "Choose an anime title.",
  ),
  provider: z.string().max(120).default(""),
});
export const animePlaylistSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  updatedAt: z.number().finite(),
  items: z.array(playlistItemSchema).max(500),
});
export type AnimePlaylist = z.infer<typeof animePlaylistSchema>;
export const playlistCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(1).max(80),
  }),
  z.object({
    action: z.literal("rename"),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
  }),
  z.object({ action: z.literal("delete"), id: z.string().uuid() }),
  z.object({
    action: z.literal("add"),
    id: z.string().uuid(),
    entry: playlistItemSchema,
  }),
  z.object({
    action: z.literal("remove"),
    id: z.string().uuid(),
    key: z.string().min(1).max(2500),
  }),
  z.object({
    action: z.literal("move"),
    id: z.string().uuid(),
    key: z.string().min(1).max(2500),
    to: z.number().int().min(0).max(499),
  }),
]);
export type PlaylistCommand = z.infer<typeof playlistCommandSchema>;
