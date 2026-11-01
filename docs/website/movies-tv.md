# Movies and TV sources

Movies and Series now browse installed native Vestra sources. Choose a source,
search a title or choose a collection, open its details, and play. TV details
group episodes by season and offer a season filter. Resume, episode bookmarks,
watched state and Plan to Watch use Vestra's existing storage and player.

The Catalogue tab retains configured metadata providers such as TMDb and existing
local-file playback. A catalogue listing is not a promise of source availability.
If no Movies/TV source is installed, Vestra shows an installation empty state.
The [native MovieBox source](moviebox.md) is now available for its public guest
flow. Other website integrations are separate extensions.

## Start an extension

Copy the native authoring template from the repository:

```powershell
Copy-Item -LiteralPath packages/extension-host/examples/screen-source-template -Destination my-screen-source -Recurse
```

The template returns invented titles and placeholder streams. Replace those with
the selected website's API/HTML requests and parsing before using playback.
Install through **Extensions → Choose extension folder**, using the existing
permission review. Do not install CloudStream `.cs3` or `.jar` packages: those
are not executable Vestra extensions.

## SDK 1.3 contract

Use `role: "stream-source"`, `sdkVersion: "1.3.0"` and `kinds: ["movie", "tv"]`.
Keep `search`, `getEpisodes` and `getStreams`; discovery's `browse` is optional.

`search(query, { kind, limit })` and
`browse(category, { kind, page, limit })` receive `movie` or `tv`. Return each
title with a stable `id`, `title`, `kind`, and optional HTTPS `cover`, `url` and
numeric `year`. The host stamps the source identity. Mixed sources must identify
every result's kind so a movie is never guessed to be a TV series. A single-kind
source may omit `kind` for compatibility.

`getEpisodes(titleId)` returns stable entry IDs, parent `animeId` (retained for
SDK compatibility), `number`, optional `season` and optional `title`/HTTPS `url`.
Use `season: 0` for specials. Episode numbers may restart in each season; entry
IDs must remain distinct. A movie normally returns one feature entry. Vestra
does not display a movie as season 1 episode 1.

`getStreams(entryId)` returns server/MP4/HLS results through the existing streaming
contract. Stream extraction happens on play, not for every poster in a search.
Return actual video or playlist URLs; an HTML embed page is not a direct stream.
Only label resolution when the source supplies it. Reuse subtitles and required
request headers from the existing contract.

Use brokered `host.fetch({ url })`, check `response.status`, and parse its string
`response.body`. Declare network permission and exact API/image/CDN hosts. The
isolate has no DOM, Node.js or global browser `fetch`. Bundle any parser into the
entry file. Site-specific extraction belongs in the extension rather than the
player or application routes.

## Choosing the first site

For another site, record its search, title, season, episode and stream
responses as fixtures. Implement and validate that site's mapping independently
of this app support. A registry JSON describes installable packages; it does not
contain their scraping implementation. The supplied
[CloudStream catalogue](https://raw.githubusercontent.com/Shakzz890/cloudstream-extensions-shakzz/builds/plugins.json)
illustrates artwork, versions and supported media types, but is not a Vestra
registry or a source adapter.
