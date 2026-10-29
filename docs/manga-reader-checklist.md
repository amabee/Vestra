# Manga reader checklist

## Core reading experience

- [x] Single and double pages with optional separate cover and odd-page handling.
- [x] Continuous long strip with small separators.
- [x] Gapless Webtoon layout for vertically sliced pages.
- [x] Load images near the viewport and release decoded image data offscreen.
- [x] Track the visible page during scrolling; only save after a successful decode.
- [x] Restore chapter/page and expose Continue Reading.
- [x] Save layout, direction, fitting and zoom per provider/series. Existing global
      preferences seed a series until it has its own settings.
- [x] Suggest Webtoon when decoded images are at least 2.5 times taller than wide;
      require an explicit choice before switching.
- [x] Click the page to hide controls; click again to show them. Mouse movement and
      idle time leave the chosen state alone. Double-click resets zoom, and page
      drags do not toggle controls.
- [x] Fullscreen button and F shortcut using the reader element's fullscreen API.
- [x] S toggles settings, I toggles immersive reading, Escape closes drawers.
- [x] Direction-aware arrows, Home/End and Space (next page, or viewport scroll for
      vertical layouts). Editable fields retain their normal keyboard behavior.
- [x] Clickable/draggable progress slider with page count and percentage.
- [x] Hover thumbnails on the progress slider without advancing saved progress.
- [x] Centered manga title and page navigation, icon actions on the bottom right,
      and a searchable chapter menu that opens upward beside them.
- [x] Previous/next chapter and manual end-of-chapter action.
- [x] Direction-aware look-ahead downloads, shared page/preview cache, and four
      parallel guarded image download lanes; see [loading behavior](manga-reader-loading.md).
- [x] Floating settings, direction hint, height/width/page/original fitting and
      custom zoom. Vertical layouts always fit strip width.
- [x] Ctrl + wheel zoom and double-click reset.

## Later additions from the requested feature list

- [ ] Persistent bookmarks and per-page notes.
- [ ] Dedicated reading window and compact multi-monitor mode.
- [ ] Optional delayed/automatic next-chapter transitions.
- [ ] Optional reading time, streaks and completion statistics.
- [ ] Cross-chapter preloading (nearby images within the current chapter load now).
- [ ] Full reading history beyond the existing recent reading list.

## Verification

- [x] Navigation/preferences tests cover cover alignment, RTL, vertical stepping,
      malformed settings, provider/series isolation and tall-image recommendations.
- [x] Offscreen Electron fixture uses real PNG decoding and scroll geometry: bounded
      initial image requests, slider jumps, failure/retry and progress, offscreen
      release, settings shortcuts, click hide/reveal, hover previews, title/navigation
      placement, upward chapter menu and per-series restoration under React StrictMode.
- [ ] Personally verify with real manga/webtoon providers, including very long
      images, window resizing and fullscreen. The fixture never shows a desktop
      window and deliberately does not enter fullscreen.

Run the offscreen fixture with `pnpm test:manga:ui`. This rebuilds the renderer CSS
first; it uses synthetic local images and an ephemeral browser session, not user
provider data.
