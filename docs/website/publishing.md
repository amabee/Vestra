# Publish an extension

Publish a native manifest and JavaScript entry over HTTPS. Distribution itself
does not require a separate hosted backend.

## Direct manifest installation

Place `manifest.json` and `index.js` in the same published directory and set
`main` to `index.js`. Users paste the manifest URL into Add an extension.
The installer resolves the entry file beside that URL.

For reproducible releases, use commit-pinned raw URLs or immutable release
assets. Branch URLs work but can change independently of a user's review.

## Registry listings

A registry is an HTTPS JSON array:

```json
[{
  "id": "my-anime-source",
  "name": "My Anime Source",
  "version": "1.0.0",
  "type": "onlinestream-provider",
  "manifestURI": "https://your-domain.com/extensions/my-anime-source/manifest.json",
  "icon": "https://your-domain.com/extensions/my-anime-source/logo.png",
  "description": "Anime streaming source for Vestra."
}]
```

Domains above are illustrative. `payloadURI` is optional when the manifest can
resolve its entry file. Registry categories are labels; `sdkVersion` selects the
native path. Manga listings use `manga-provider`. Native metadata listings can
use `plugin` or `custom-source`.

## Installation and integrity

Users review permissions and hosts before enabling extensions. Vestra fingerprints
installed code. Replacing published files does not silently update the installed
payload. Keep release notes, author credits and required source notices with releases.

## Before publishing

Verify search, stable IDs, ordering, streams or images, permission denial, empty
results and useful errors. Check every declared discovery category and pagination.
Test a folder install and a direct manifest install separately.
