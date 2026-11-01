# Discovery feeds

SDK 1.2 adds optional source-owned anime discovery. The three required streaming
methods stay unchanged; older sources do not need to implement new methods.

SDK 1.3 also enables Movies/TV feeds. Their manifest declares `kinds: ["movie",
"tv"]`, and `browse(category, { kind, page, limit })` receives the requested kind.
Return `kind` on every result from a mixed source. See the
[Movies and TV guide](movies-tv.md).

## Declare categories

Add `discovery` to a native stream-source manifest:

```json
{
  "sdkVersion": "1.2.0",
  "role": "stream-source",
  "kinds": ["anime"],
  "discovery": {
    "categories": ["suggested", "ongoing", "latest", "upcoming", "popular"]
  }
}
```

This fragment belongs inside a complete manifest with identity, entry file and
permissions. Declare only categories your source provides. Suggested means a
source-curated feed, not personalized recommendations. Ongoing means airing,
latest follows source updates, upcoming is announced content and popular follows
the source's ranking.

## Implement browse

Return `browse` alongside the required methods from `activate`:

```js
async browse(category, { page = 1, limit = 24 } = {}) {
  const response = await host.fetch({
    url: `https://api.your-domain.com/anime/${category}?page=${page}&limit=${limit}`
  });
  if (response.status !== 200) throw new Error("Source feed could not be loaded.");
  const data = JSON.parse(response.body);
  return {
    items: data.results.map(row => ({ id: String(row.id), title: row.title, cover: row.cover })),
    hasMore: Boolean(data.hasNextPage)
  };
}
```

Adapt fields to the actual API and declare its host. The host validates results,
stamps source identity and caps pages at 24 items. `hasMore` controls Next; page
numbers start at one. Covers are optional HTTPS strings. Use the same title IDs
as `search` and `getEpisodes`.

## Loading and lifecycle

Requests are bounded and cached per registered source and category/page. Disable,
uninstall or replacement invalidates that runtime identity. Late results from
the old source are refused. Undeclared categories are not called as native feeds.
Failed or malformed responses show an error with a retry action.

## Catalogue fallback

Sources without discovery can use labelled AniList catalogue discovery while
retaining the chosen playback source. These titles are not claimed to exist on
that source until matching occurs. Neither mode silently changes the selection.
