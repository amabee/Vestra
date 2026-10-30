# Anime search, playback and playlists

The Anime screen now owns the main discovery/search/play/save flow. Films and series keep their existing catalogue view; manga and extension management retain their routes.

## User flow

1. Open Anime and choose **Play from**. Search once, or browse poster cards.
2. **Play** goes directly to the player. **Resume** chooses the most recently active unfinished episode and position. Title/artwork links open the existing details and episode browser when a particular episode is needed.
3. The bookmark saves to **Watch later**, using the existing watchlist repository. The playlist icon opens one picker for Watch later and named playlists. **Create & save** creates a list and adds the title in the same flow.
4. The **Playlists** tab opens named collections, with per-title Play, rename, remove, reorder and explicit delete controls. Entries are saved titles; playing an entry opens that anime's episode queue.

Search queries go to anime catalogue providers. The same submitted query also supplies **Source matches**, a secondary recovery path for titles whose catalogue name does not match a streaming provider. Source matching does not introduce another search field. Saving a source result reads its known metadata without loading episodes or video.

Continue-watching cards use existing history/progress. Closing playback refreshes history as well as progress. The title-bar search routes into the same Anime search flow from an anime details page. The Anime screen uses its main search field without a competing title-bar input.

## Provider and identity handling

- The URL's `source` remains authoritative. A locally remembered valid source is only the fallback for fresh navigation without that parameter; explicit unavailable sources stay visible instead of silently switching.
- The same selected source applies to discovery, Watch later and playlist playback. A playlist entry records its save-time provider as provenance, rather than maintaining a competing active provider selection.
- Saved provider-only titles contain the actual provider's anime title ID and metadata, never an opaque search handle or a signed video URL. On restart, the backend can request episodes using that real anime ID. Provider-title details can recover metadata from playlists, watchlist, history or the current search inventory.
- Catalogue playback still fetches authoritative provider details in main before title matching. Switching a saved provider-only title to another source uses exact title matching through the existing adapter, rather than passing one provider's ID to another.
- Local files remain selectable when indexed and reuse built-in playback resolution.
- Direct Play shares compatible episode query caches with details. It reads current progress before opening, suppresses cancelled/stale requests and supports an explicit fresh retry.

## Persistence

Named lists live in `anime-playlists-v1.json` in the existing application data directory. Commands are schema validated in main and serialized across read-modify-write operations; the existing filesystem driver's atomic writes remain in use. Duplicate title additions update the entry rather than creating another copy. Limits are 100 lists and 500 entries per list. No source must be enabled to organize saved titles.

Watch later continues to use the existing watchlist document. No stored watchlist, progress, bookmark or source definitions are migrated or deleted by the redesign.

## Verification

- `test-anime-playlists.mjs`: real filesystem persistence/reopen, concurrent additions, duplicate updates, ordering, rename/remove/delete, input validation, save without a source, and resume selection.
- `test-anime-service.mjs`: saved provider IDs reopen after service restart; saving known metadata does not request episodes or video; existing provider, identity and mirror checks remain covered.
- `test-anime-ui.mjs`: offscreen Electron search/play/save flow, Watch later, create-and-save, named-list playback, provider-only saved IDs, rename/reorder, stale Play cancellation, resume, source preference and existing details/extension recovery checks.
- Desktop and narrow viewport captures were inspected using test data; no live user playlist was modified. Build and TypeScript checks complete the verification.
