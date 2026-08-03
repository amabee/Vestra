/**
 * @vestra/api — provider clients.
 *
 * Every module here is SERVER-ONLY: they read credentials from the environment.
 * Import them from Server Components, route handlers or the Electron main
 * process — never from a client component.
 */

export * from "./errors";
export * from "./http";

export * as tmdb from "./tmdb/index";
export * as anilist from "./anilist/index";
export * as youtube from "./youtube/index";
export * as qbittorrent from "./qbittorrent/index";
export * as mediaserver from "./mediaserver/index";
