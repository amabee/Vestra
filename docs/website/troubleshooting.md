# Troubleshooting

Start with the message shown in Extensions, Anime or the reader. A source can load
successfully while its upstream website is unavailable.

## The app opens an old UI

`pnpm --filter @vestra/nova start` runs the existing build. Rebuild with
`pnpm --filter @vestra/nova build`, then restart. Use `dev` for live app UI changes.
Extension folders are installed copies; choose the folder again after editing code.

## No sources are available

Confirm the source is installed and enabled. Check Installed for native sources
and Compatibility for imported scripts. Select one in Anime or Manga Library.
A disabled or removed source is not replaced silently.

## Permission or host errors

Network needs declared and approved hostnames. Include exact API and image/CDN
domains. Native extensions use `host.fetch`; global browser fetch is unavailable.
Fix the manifest and review it again.

## A title has no episodes or chapters

Catalogue metadata and source availability are separate. Try direct source search
for alternate names or editions. Upcoming anime may have no episodes. Confirm the
selected source and try the retry action.

## A video keeps loading

Try another offered mirror and inspect the source error. Return a direct MP4 or
HLS URL, not an embed page. Auto prefers HD; explicit manual choices are retained.
An empty upstream response cannot be repaired by changing the quality label.

## Manga artwork or pages fail

Confirm image URLs use HTTPS and image hosts have grants. Return raster-image
URLs and page metadata in the manga contract's shape, not HTML or raw bytes.

## Report an issue

Include the app version, source name and version, title, episode or chapter,
visible error and whether it happens before playback or during it. Avoid posting
signed URLs, credentials or personal history publicly.
