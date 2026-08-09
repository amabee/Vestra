# Writing a Vestra extension

An extension adds a source of metadata to Vestra. It runs inside a QuickJS
isolate with no DOM, no filesystem, no timers and no network of its own — the
only thing it can reach is the `host` object it is handed, and that carries
exactly the permissions the user agreed to.

That is a deliberate trade. An extension cannot restyle the interface or inject
a script, because anything that could do those things could also read your
library and send it somewhere. What it can do is answer questions about media.

Two worked examples live in `examples/`:

| | what it shows |
|---|---|
| `open-library/` | the bare contract, no `kinds`, loads but is not a search source |
| `kitsu/` | a real provider — declares `kinds`, registers, results appear in search |

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
| `kinds` | `anime`, `movie`, `tv`, `kdrama`, `youtube-video`, `local-video`. |

**`kinds` is what makes an extension a provider.** Declare none and it loads
fine but is never offered as a search source — there would be nowhere to file
its results. Declare some and export `search`, and Vestra registers it.

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

**Extensions → Load unpacked**, pick your folder, review the permissions.

Vestra reads `manifest.json` and `main` straight off disk. The consent screen is
the same one a registry install shows. Nothing is pinned — a folder can change
under you, and Vestra says so rather than pretending otherwise.

A local HTTP server will not work: outbound fetches refuse loopback and private
addresses, deliberately, so reading the folder is the way in.

Re-run Load unpacked after changing your code.

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

`payloadURI` must be in the listing. Vestra fingerprints those exact bytes at
install and re-checks on every read, so a listing without one cannot be
installed at all.

Point at a commit, not a branch. Both work, but a branch can change after the
user consented, and Vestra will label it as such.

Users add registries under **Extensions → Registries**. Vestra ships none.

## What will not be accepted

`onlinestream-provider`, `anime-torrent-provider` and `manga-provider` are
listed by the UI and cannot be installed. They resolve content by scraping
sites that redistribute without a licence from the rights holder, and Vestra
does not ship that. It is a decision rather than a missing feature, so it is
not coming in a later version.

Metadata, enrichment, and sources pointing at servers you own are all fair game.
