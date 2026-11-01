# Writing a Vestra extension

Start with the [native extension quickstart](../../docs/extension-quickstart.md)
for the folder layout, anime and manga templates, and local installation.

SDK 1.1 also supports native manga sources with `role: "manga-source"` and
`search`, `getChapters`, `getPages` exports. See the
[manga SDK guide](../../docs/native-manga-sdk.md) and
[authoring template](examples/manga-source-template/). The metadata contract
below remains compatible with SDK 1.0 extensions.

An extension can add metadata, anime streaming or manga reading sources to Vestra. It runs inside a QuickJS
isolate with no DOM, no filesystem, no timers and no network of its own — the
only thing it can reach is the `host` object it is handed, and that carries
exactly the permissions the user agreed to.

That is a deliberate trade. An extension cannot restyle the interface or inject
a script, because anything that could do those things could also read your
library and send it somewhere. What it can do is answer questions about media.

Worked examples live in `examples/`:

| | what it shows |
|---|---|
| `open-library/` | the bare contract, no `kinds`, loads but is not a search source |
| `kitsu/` | metadata provider — declares `kinds`, registers, results appear in search |
| `stream-source-template/` | native anime search, episodes and streams; placeholder data |
| `manga-source-template/` | native manga search, chapters and pages; placeholder data |

## The manifest

`manifest.json`, beside your code:

```json
{
  "id": "example-kitsu",
  "name": "Kitsu",
  "version": "1.0.0",
  "main": "index.js",
  "sdkVersion": "1.0.0",
  "permissions": ["network"],
  "hosts": ["kitsu.io"],
  "kinds": ["anime"]
}
```

| field | notes |
|---|---|
| `id` | letters, digits, `.`, `-`, `_`. Used in storage keys, so it stays inert. |
| `main` | entry file, resolved inside your folder. It cannot point outside it. |
| `sdkVersion` | the contract you built against. A newer major than the host is refused rather than half-supported. |
| `permissions` | `network`, `library:read`, `progress:read`. Ask for nothing you do not use — every one of them is shown to the user with its worst case spelled out. |
| `hosts` | bare hostnames. Required with `network`, refused without it. "Anywhere" is not something a user can consent to. |
| `kinds` | Catalogue kinds: `anime`, `movie`, `tv`, `kdrama`, `youtube-video`, `local-video`. Anime stream sources use `["anime"]`; manga sources omit this field. |
| `role` | `metadata` (default), `stream-source`, or `manga-source`. Each role has its own method/result contract. |
| `icon` | Optional HTTPS logo URL, displayed on the extension card. |

For **metadata** extensions, declare `kinds` and export `search` to register in
catalogue search. Stream sources and manga sources use separate role-specific
routing and contracts; manga sources do not declare catalogue kinds.

## The code

Export `activate`. Return the methods you want the host to call.

```js
export function activate({ host, manifest }) {
  if (typeof host.fetch !== "function") {
    throw new Error("This extension needs internet access.");
  }

  return {
    async search(query, { limit }) {
      const response = await host.fetch({
        url: `https://kitsu.io/api/edge/anime?filter%5Btext%5D=${encodeURIComponent(query)}`,
        headers: { accept: "application/vnd.api+json" },
      });

      if (response.status !== 200) return [];

      return JSON.parse(response.body).data.map((record) => ({
        id: record.id,
        title: record.attributes.canonicalTitle,
        year: null,
        poster: null,
        description: "",
        isSeries: true,
      }));
    },

    async getDetails(id) {
      return null;
    },
  };
}

export function deactivate() {}
```

Throwing from `activate` is the right move when a permission you need was
declined. Failing then is actionable; returning empty results later is not.

### What the host gives you

| method | needs | notes |
|---|---|---|
| `host.log(level, message)` | — | always present, tagged with your id |
| `host.fetch({ url, method, headers, body })` | `network` | https only, your declared hosts only, rate limited |
| `host.readLibrary()` | `library:read` | not yet relayed on desktop |
| `host.readProgress()` | `progress:read` | not yet relayed on desktop |

A method for a permission you were not granted is **absent**, not present and
throwing. Check with `typeof host.fetch === "function"` rather than catching.

### What you return

`search(query, { limit })` returns an array:

```ts
{ id: string, title: string, year: number | null,
  poster: string | null, description: string, isSeries: boolean }
```

`getDetails(id)` returns one of those plus `genres: string[]`,
`episodeCount: number | null`, `rating: number | null` — or `null`.

`id` is yours. It comes straight back to `getDetails`, so make it something you
can act on, and validate it when it arrives: it is the one value a caller can
choose. Both examples check the shape before using it.

Everything is validated at the boundary. A malformed entry is dropped and
logged; the rest of the results survive. Posters must be https or they are
discarded.

Only plain JSON crosses. No functions, no class instances, no host references.

## Developing

Build against a folder rather than a registry:

**Extensions → Choose extension folder**, pick your folder, review the permissions.

Vestra reads `manifest.json` and `main` straight off disk. The consent screen is
the same one a registry install shows. Nothing is pinned — a folder can change
under you, and Vestra says so rather than pretending otherwise.

A local HTTP server will not work: outbound fetches refuse loopback and private
addresses, deliberately, so reading the folder is the way in.

Choose the extension folder again and review the install after changing your code.

## Publishing

A registry is a JSON array served over https. Each entry:

```json
{
  "id": "example-kitsu",
  "name": "Kitsu",
  "version": "1.0.0",
  "type": "plugin",
  "manifestURI": "https://raw.githubusercontent.com/you/repo/<commit>/manifest.json",
  "payloadURI": "https://raw.githubusercontent.com/you/repo/<commit>/index.js",
  "description": "..."
}
```

`payloadURI` is optional in the listing. The installer resolves it from the
manifest's `payloadURI`, or resolves the native manifest's relative `main` beside
the manifest URL. A listing needs a usable `manifestURI`. Users can also paste a
manifest URL directly into **Extensions → Add an extension**, without a registry.
Vestra fingerprints the installed payload and checks its integrity when loading.

Point at a commit, not a branch. Both work, but a branch can change after the
user consented, and Vestra will label it as such.

Users add registries under **Extensions → Registries**. Vestra ships none.

## Native and compatibility formats

New extensions should use the Vestra SDK manifest and `activate` contract above.
Registry category labels such as `onlinestream-provider` and `manga-provider` do
not decide the execution format: `sdkVersion` identifies the native SDK manifest.
Existing provider scripts use the optional Compatibility importer and a different
API. They are supported imports, not native Vestra extensions.

Extensions have no browser DOM, Node.js modules, filesystem or unrestricted
network. Use `host.fetch` for API requests and declare the required hosts. Bundle
TypeScript and dependencies into one compatible JavaScript entry file before
installing a native SDK extension. Its `main` must be inside the selected folder.
