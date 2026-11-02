# Internet Archive · Classics

A native Movies-only source using Internet Archive's public search and metadata
APIs. No account, API key, extra server or TMDb configuration is required.
The catalogue is the `feature_films` collection: classic and archival films,
not a promise of current mainstream movies or TV series.

## Install

Open **Extensions → Available**, find **Internet Archive · Classics**, and click
**Install**. Review its network access to `archive.org`, then confirm. Open
Movies to browse or search. If you use custom registries, add the Vestra registry:

`https://raw.githubusercontent.com/amabee/Vestra/main/extensions/registry.json`

Folder installation remains available for extension development. No profile is
modified by the test scripts. Registry releases pin manifest and code URLs to an
immutable commit.

## Behavior

- Popular sorts the archive's download counts. Latest sorts additions to the
  archive, not the films' release dates. Requests use the app's bounded page size.
- Search is limited to film titles and keeps user text literal. Metadata and
  stream resolution happen after opening/playing a film, not for every poster.
- Restricted/dark items, private files, unsafe paths and known preview/short
  clips are refused. Search may still show an item that has become unavailable.
- Each item becomes one feature entry. MP4 alternatives retain reported heights;
  unknown heights use Auto. Multi-part film assembly and TV seasons are not
  implemented. Editions and metadata quality depend on the archive item.
- Small public SRT/VTT caption files are attached when available; generated
  captions are labelled. Captions can contain transcription errors.
- API requests stay on archive.org. The native player follows the archive's
  download redirects to its media servers; the extension gets no wildcard hosts.
- Playback metadata is trimmed and cached for ten minutes, up to 32 items. No
  browsing step fetches complete films or the complete archive catalogue.

## Verification

```powershell
pnpm test:archive
pnpm test:archive:live --mpv
```

The live check uses the actual isolate/broker, checks search, two Popular pages,
Latest additions and playback of **His Girl Friday (1940)**. Bundled mpv decoded
H.264 video/AAC audio and loaded the supplied SRT caption. Reported renditions
were 480p/240p in that sample; no universal HD or availability claim is made.

See the [installation guide](../../docs/website/internet-archive.md).
