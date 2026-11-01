# Create your first Vestra extension

An extension is a folder containing `manifest.json` and a JavaScript entry file.
You do not need a separate C# project or the compatibility importer. Vestra loads
native extensions in its QuickJS isolate and connects them to its host services.

## Start from a template

From the Vestra repository root in PowerShell:

```powershell
Copy-Item -LiteralPath packages/extension-host/examples/stream-source-template -Destination my-anime-source -Recurse
```

For manga, copy `packages/extension-host/examples/manga-source-template` instead.
For Movies/TV, copy `packages/extension-host/examples/screen-source-template` and
follow the [Movies and TV guide](website/movies-tv.md).
Use a new destination folder for each extension.

These templates use invented titles and placeholder URLs. They demonstrate the
contracts; they are not live sites and do not provide playable video or pages.

## The manifest

Edit your copied `manifest.json`. This native anime source manifest is enough for
static search/episode/stream data:

```json
{
  "id": "my-anime-source",
  "name": "My Anime Source",
  "version": "1.0.0",
  "sdkVersion": "1.1.0",
  "main": "index.js",
  "role": "stream-source",
  "kinds": ["anime"],
  "permissions": [],
  "hosts": [],
  "author": "Your name",
  "description": "Anime streaming source for Vestra."
}
```

An optional `icon` field accepts an HTTPS logo URL. Missing or broken artwork
falls back to the extension name's initials.

For API requests through `host.fetch`, declare `"permissions": ["network"]` and
exact bare hostnames in `hosts`, for example `["api.your-domain.com"]`. Approve
that permission and those hosts during installation. Do not add URL schemes,
paths or wildcard subdomains. Manga image/CDN hosts also need explicit grants.

## The entry file

A minimal static anime source looks like this:

```js
export function activate() {
  const title = { id: "my-series", title: "My Series" };
  const episode = {
    id: "my-series-episode-1",
    animeId: title.id,
    number: 1,
    title: "Episode One",
  };

  return {
    async search(query, { limit = 20 } = {}) {
      const text = String(query).trim().toLowerCase();
      return text && title.title.toLowerCase().includes(text)
        ? [title].slice(0, limit)
        : [];
    },
    async getEpisodes(animeId) {
      return animeId === title.id ? [episode] : [];
    },
    async getStreams(episodeId) {
      if (episodeId !== episode.id) return [];
      return [
        {
          server: "My server",
          videoSources: [
            {
              url: "https://media.your-domain.com/episode-1.mp4",
              quality: "1080p",
              type: "mp4",
            },
          ],
        },
      ];
    },
  };
}
```

Replace the illustrative media URL with an actual HTTPS video URL before trying
playback. Label quality according to the actual source; the label does not
upgrade the video. For HLS, return the manifest URL with `type: "hls"`.

A real integration replaces the static data with requests and parsing. Obtain
API responses with `await host.fetch({ url })`; check `response.status` and parse
`JSON.parse(response.body)`. This is not a browser Response: it has a body string,
not `response.json()`. Global `fetch`, `window`, `document` and Node.js imports are
unavailable. Return plain JSON-compatible objects and keep IDs stable.

## Load and try it

1. Start Vestra: `pnpm --filter @vestra/nova start` (use `dev` for app UI development).
2. Open **Extensions → Choose extension folder** and choose your new folder.
3. Review its permissions and install.
4. Choose **My Anime Source** in the Anime source menu and search **My Series**.
5. Open its episode and play after replacing the example video URL.

Local loading reads and stores an installed copy. Editing the source folder is
not live reloading: choose it again and review installation after changes. Keep
the extension ID stable; changing it creates a different source identity.

## Choose the right contract

| Extension           | Manifest role                                          | Required source methods                                  |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| Anime streaming     | `stream-source`, `kinds: ["anime"]`                    | `search`, `getEpisodes`, `getStreams`                    |
| Movies/TV streaming | `stream-source`, `kinds: ["movie", "tv"]`, SDK `1.3.0` | `search`, `getEpisodes`, `getStreams`; optional `browse` |
| Manga reading       | `manga-source`, omit `kinds`                           | `search`, `getChapters`, `getPages`                      |
| Catalogue metadata  | `metadata`, declare catalogue `kinds`                  | `search`; details/trending are additional capabilities   |

These contracts have different result shapes. Use the corresponding template;
do not substitute manga page objects for video sources. Vestra owns playlists,
bookmarks and reading/playback progress; a source does not need its own database.

## Sharing and documentation

Publish the manifest and JavaScript entry over HTTPS. Users can paste the manifest
URL into **Extensions → Add an extension**, or add a registry listing. A native
manifest's relative `main` resolves beside the manifest URL. Commit-pinned URLs
make releases reproducible. Display logos through `icon`, and keep author credits
and source notices intact.

See the [full authoring guide](../packages/extension-host/README.md),
[anime template](../packages/extension-host/examples/stream-source-template/) and
[manga guide](native-manga-sdk.md) for the complete example shapes.

The next documentation-site phase should publish this quickstart alongside app
setup, native anime/manga guides, manifest and host API references, publishing,
troubleshooting and compatibility migration. Films and TV work follows that site.
