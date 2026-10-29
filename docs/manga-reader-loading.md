# Reader controls and loading

The reader keeps its title centered at the top and previous/page count/next centered
at the bottom. Settings, immersive reading and fullscreen use labelled icon buttons
on the right, followed by the chapter selector. Its searchable menu opens upward.
Controls float over the canvas so hiding them does not resize the page.

A page click toggles all reader controls. Moving the pointer and waiting do not
reveal them. I also toggles them; S opens settings explicitly. Double-click retains
zoom reset without toggling controls, and dragging the page does not toggle them.

Progress hover shows a thumbnail after a 100 ms pause. Preview errors are local to
the tooltip. Loading a preview never marks a page read or changes the reading
position; the visible reader image still must decode before progress is saved.

## Faster page turns

- One chapter-owned loader de-duplicates visible-page, preview and preload requests.
- It looks six pages ahead and two behind in the latest travel direction, including
  paged layouts. Position changes discard obsolete queued background downloads.
- Up to four requests run concurrently. Background look-ahead uses at most three,
  reserving room for the visible page or a hover preview. Queued foreground requests
  take precedence over previews and look-ahead. Moving the preview cancels older
  previews that have not started downloading.
- A least-recently-used cache retains up to 32 entries and 32 MiB of image strings,
  conservatively counted as two bytes per character. Leaving the chapter clears
  this cache. The cache also survives React's development effect replay correctly.
- Decoded offscreen reader images are still unmounted. Retained compressed image
  strings let them reopen without another network download while cached.
- Main uses four lazily started, image-only C# sidecars. These keep image requests
  off the serial provider-script/progress lane. A sidecar exits after 60 idle seconds,
  and all exit during application shutdown. A failed image is not silently replayed.
- Images retain the existing guarded HTTPS transport, header validation, pinned
  public addresses, redirect checks and 2 MiB response limit. In-flight results from
  a replaced or disabled source are rejected in main.

This removes serial image fetches and repeated downloads; it does not establish a
universal live-site speedup. Provider latency, image size and network throughput
still determine first-load time. Fullscreen and real provider use remain manual
verification items.

## Checks

`pnpm test:manga:preload` covers priority/capacity, de-duplication, LRU eviction,
immediate retry, obsolete look-ahead cancellation, hover mapping, four download lanes
and the real sidecar's rejection of private HTTPS destinations.

`pnpm test:manga:ui` runs the reader in an offscreen Electron window with local PNG
fixtures, real image decoding, production CSS and React StrictMode. It verifies
click visibility, unchanged canvas height, hover previews that do not save progress,
centered controls, icon labels and the chapter menu's upward placement, along with
the existing scrolling, retry, settings and per-series behavior. It never shows a
window or enters fullscreen.
