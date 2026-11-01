# Anime source contract

Set `role` to `stream-source` and `kinds` to `["anime"]`. Return all three required
methods from `activate`: `search`, `getEpisodes` and `getStreams`.

## Search titles

```js
async search(query, { limit = 20 } = {}) {
  return [{ id: "series-a", title: "Series A" }].slice(0, limit);
}
```

Return at most 50 candidates. Each title needs a stable `id` and `title`. Optional
`cover` and `url` are HTTPS URL strings. Vestra stamps `provider` from the installed
identity; an extension cannot impersonate another source.

## List episodes

```js
async getEpisodes(animeId) {
  if (animeId !== "series-a") return [];
  return [{ id: "series-a-ep-1", animeId, number: 1, title: "Episode One" }];
}
```

Episode `number` is the source's label, not its array index. Nonnegative decimal
numbers are allowed. Keep IDs unique within the source. The desktop queue currently
uses up to 2,000 episodes per title.

## Return streams

```js
async getStreams(episodeId) {
  if (episodeId !== "series-a-ep-1") return [];
  return [{
    server: "Main",
    videoSources: [{
      url: "https://media.your-domain.com/episode-1.mp4",
      type: "mp4",
      quality: "1080p"
    }]
  }];
}
```

The URL is illustrative. Return an actual HTTPS media URL, not an embed webpage.
Video `type` is `hls` or `mp4`; quality describes the actual rendition. Return
multiple servers when alternatives exist. Optional server or video headers can
carry a required Referer. Per-video headers override server headers.

## Subtitles

Videos can include `subtitles`: an array of `{ id, url, language, title?,
isDefault? }` objects. URLs must use HTTPS. The host forwards validated headers
and subtitle metadata to the player.

## Optional discovery

SDK 1.2 sources can declare categories and implement `browse`. See
[Discovery feeds](discovery.md). Existing search-only extensions remain valid.
Start with the [complete quickstart](../extension-quickstart.md).
