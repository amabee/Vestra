# KissKH source

KissKH is a native Movies/TV source for Asian dramas and movies. It provides
Popular, Latest, Ongoing and Upcoming collections, typed search, available
episodes, direct video and plain SRT/VTT subtitles.

## Install

1. Rebuild/start the current app with `pnpm --filter @vestra/nova build` and
   `pnpm --filter @vestra/nova start`.
2. Open **Extensions → Choose extension folder** and select `extensions/kisskh`
   in the Vestra checkout.
3. Review its hosts and source-session/header permission, then install.
4. Open Movies or Series and choose KissKH in **Browse from**.

The extension needs no browser cookies or existing account. It uses the source's
public request format through Vestra's network broker. Nothing is auto-installed.

## Reading source information

Fractional entries such as episode 13.5 keep their own IDs and progress. Season
numbers are omitted when the source does not provide them. The site's upload
date is not treated as a production/release year.

Quality is **Auto**, because the API does not provide a reliable resolution
label. Its video-type flag determines HLS versus MP4; a `.mp4` URL may actually
contain an HLS playlist. Vestra retains the correct format label and uses its
existing player for playback.

Only direct video and plain SRT/VTT tracks are returned. Iframe-only playback and
encrypted `.txt` captions are unsupported. Missing subtitles do not block an
otherwise playable video. All-title availability and sustained playback depend
on the site and your connection.

For another website, follow the [Movies/TV authoring guide](movies-tv.md).
