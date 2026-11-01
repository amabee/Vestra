# Native manga extensions (SDK 1.1)

Vestra SDK manga sources now connect directly to the existing Manga Library,
catalogue-to-source matching, details, covers, reader, bookmarks and reading
progress. They use Vestra's `activate` contract and isolate runtime; no provider
compatibility import is required.

## Manifest and methods

Use `role: "manga-source"`, `sdkVersion: "1.1.0"`, an entry module and explicit
network permissions/hosts. Omit `kinds`: this role already identifies a manga
source, and manga reading is separate from the video catalogue's content kinds.

`activate({ host, manifest })` must return all three methods:

| Method | Result |
| --- | --- |
| `search(query, { limit })` | Array of `{ id, title, cover?: { url, headers? } }` |
| `getChapters(bookId)` | Array of `{ id, title, number, index, language?, scanlator? }` |
| `getPages(chapterId)` | Array of `{ url, index, headers? }` |

IDs are provider-owned opaque strings. Title IDs must remain stable across
restarts. Chapter IDs must identify a chapter across the provider, not merely
contain a chapter number reused for every title. `number` is a string so extras
and decimal chapters are supported; `index` is a nonnegative integer used for
ordering. Page indexes must be unique within their result.

Results are validated at the host boundary: up to 400 titles, 10,000 chapters
and 2,000 pages. Covers/pages require HTTPS without URL credentials. Their hosts
must be in the user's network grant, including image CDNs. Downloading image
bytes is a host operation through the existing guarded raster-image pipeline;
guest code supplies metadata and receives no filesystem access. Use `host.fetch`
for your source's metadata API and declare its hosts too.

## Install and use

1. Copy the [authoring template](../packages/extension-host/examples/manga-source-template/)
   and replace its placeholder data and hosts with your source's API.
2. Open Extensions → Installed → Load unpacked and choose the extension folder.
3. Review its requested permissions and install.
4. Select the new source in Manga Library. The same selection carries into
   details and the reader.

The template uses invented titles and `images.example.org` URLs. It demonstrates
the contract and is not a working public manga catalogue. It is not installed or
enabled automatically.

For a registry listing use type `manga-provider` and point `manifestURI` to this
SDK manifest. The installer recognizes `sdkVersion` and selects the native SDK
path, not the optional compatibility importer. Local folder installs are also
categorized as manga sources.

## Lifecycle and persistence

Native sources are registered at install, enable and app startup. Disable,
uninstall and role changes remove them from Manga Library and invalidate old
image/page handles. Late results from replaced sources are rejected. Incomplete
method sets fail activation with an explicit error.

The host stamps identity as `ext-<manifest.id>`. Progress uses the existing C#
repository under that stable source identity, so extensions do not implement
their own progress database or receive write access to the user's history.
Existing compatibility imports keep their IDs and storage unchanged.

## Verification

The native integration fixture loads the template through a real QuickJS isolate,
reviews and persists its manifest/source, searches a title, resolves a catalogue
match, loads chapters and opaque page handles, checks cover/page delivery and
forwards a progress save to the host repository. Image transport is stubbed in
that fixture; it does not fetch the placeholder URLs. Additional cases reject
ungranted image hosts, stale results after replacement, missing methods, unsafe
URLs and duplicate chapter/page identities. Existing C# reader tests cover
progress persistence and reading operations separately.

Third-party compatibility remains optional. Its metadata translator now refuses
provider-script manifests rather than misclassifying them as native metadata
extensions; supported scripts continue to use their existing compatibility
installer.
