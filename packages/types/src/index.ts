/**
 * @vestra/types — the shared domain model.
 *
 * Every provider (TMDb, AniList, YouTube, local disk, media server, qBittorrent)
 * normalises into these shapes, so Atlas, Nova and Pulse all speak one language.
 */

export * from "./media";
export * from "./search";
export * from "./library";
export * from "./settings";
export * from "./torrent";
