# Movies/TV native source support

Implemented 2026-11-01 on `movies-tv-native-sources`.

## Delivered

- Movies and Series source workspaces with poster grids, source selection,
  search, optional collections, pagination and loading/error/empty states.
- Preserved the configured metadata catalogue and local playback through a
  separate Catalogue tab.
- SDK 1.3 adds optional title `kind`/`year`, episode `season`, and requested kind
  in search/browse options. Mixed sources must identify result kinds; existing
  single-kind contracts remain compatible. Native manifests now permit
  Movies/TV discovery rather than requiring anime.
- Episode queues sort by season/episode, include season 0 specials, retain
  distinct stable progress IDs across seasons and defer extraction until play.
- Source details reopen from current results or existing saved/history
  snapshots. Disabled/replaced sources reject outstanding results and playback.
- Shared details now use streaming progress IDs for resume, episode bookmarks
  and watched mutations. Added a season filter, Plan to Watch and mobile layout
  fixes. Existing playback persistence handles Movies/TV sessions too.
- Native authoring template and published Astro guide, reusing the existing
  installer, permission broker and extension runtime. No new dependencies.

## Verification

- Nova Electron/renderer type checks and builds pass.
- Extension host: 137 tests and type checks pass, including execution of the
  Movies/TV template in the real QuickJS isolate.
- `pnpm test:screen`: eight data/queue/adapter regression cases pass.
- `pnpm test:screen:ui`: three hidden Electron scenario groups pass, covering
  browsing/search/pagination, season-specific resume/bookmarks/watched state,
  list saving, unavailable sources and retry. Poster grids reviewed at 1440 and
  375 pixels; details also checked at 375 pixels.
- Existing anime service: 16 cases; anime UI: 14 scenario groups pass.
- Docs: 16 generated routes, 369 local links/anchors and responsive/navigation/
  search checks pass.

The template uses invented titles and placeholder video URLs. No website scraper
was installed or live Movies/TV playback claimed. The user chose to build app
support first and select the first website next.

## Next integration

Choose the site, collect representative search/title/season/episode/extraction
fixtures, implement its mapping as a native extension, and verify live
search-to-play behavior. Keep source-specific requests/parsing out of app routes
and player code. The supplied CloudStream catalogue is package metadata, not
scraper source; `.cs3`/`.jar` packages are not executable Vestra extensions.

See [authoring and usage](website/movies-tv.md) and the
[reference template](../packages/extension-host/examples/screen-source-template/).
