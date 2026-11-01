# MovieBox source

Vestra's native MovieBox extension supports Movies and TV search, Popular and
Latest collections, available seasons/episodes, MP4/HLS playback and subtitles.
It uses the source's public guest flow. Availability and quality depend on the
site and your region.

## Install from the repository

1. Rebuild Nova after pulling these changes: `pnpm --filter @vestra/nova build`.
2. Start it with `pnpm --filter @vestra/nova start`.
3. Open **Extensions → Choose extension folder** and select `extensions/moviebox`
   inside the Vestra checkout.
4. Review its internet hosts and **Use source sessions** permission, then install.
5. Open Movies or Series and select MovieBox in **Browse from**.

You can also paste the
[pinned MovieBox manifest](https://raw.githubusercontent.com/amabee/Vestra/d84273671c613d0d55a1042caabc071f387b80b8/extensions/moviebox/manifest.json)
into Add an extension, or add the optional
[Vestra source registry](https://raw.githubusercontent.com/amabee/Vestra/moviebox-native-extension/extensions/registry.json)
under Registries. These paths use the same permission review; nothing is
installed automatically.

Use Popular/Latest or search a title. Its details let you select a season, resume,
bookmark episodes, mark them watched or save the title to Plan to Watch.

## Sessions and quality

The extension obtains its own temporary guest session. It does not import browser
cookies, use your signed-in browser account or save guest credentials to disk.
The separate `network:session` capability allows its own authorization/source
headers only to approved hosts. Cookie and Host request headers remain blocked.
Older network-only extensions do not silently gain this capability.

Live guest checks returned 360p/480p streams; 1080p was marked premium-locked.
Vestra offers accessible renditions with their actual quality labels. Guest
viewing limits, region restrictions and locked tracks remain respected. Account
login, premium playback and DASH are not implemented by this extension.

An episode list can include gaps when the source lists specific available
episodes. Those gaps are retained. Subtitle lookup failures leave the video
playable, while source access errors are shown rather than reported as an empty
catalogue.

## Other sources

Each website can be its own native extension, sharing Vestra's browsing, player,
subtitles and progress. It keeps its own IDs, host grants and extraction logic.
KissKH is the next candidate for Asian dramas; Pinoymoviepedia is another
candidate listed with Filipino language support in the supplied
[CloudStream catalogue](https://raw.githubusercontent.com/Shakzz890/cloudstream-extensions-shakzz/builds/plugins.json).
These candidates have not been implemented or live-verified in Vestra.

Use the [Movies/TV authoring guide](movies-tv.md) to build another source. A
CloudStream `.cs3`/`.jar` package is not directly installable as a Vestra extension.
