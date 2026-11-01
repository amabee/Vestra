# Native Vestra sources

These are source extensions for Vestra's own SDK, installed through the existing
folder/manifest review. They are not auto-installed or added to your settings.

| Source                         | Status                               | Scope                                                                |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------------- |
| [MovieBox](moviebox/README.md) | Native 0.1.0; live guest checks pass | Movies/TV, Popular/Latest, seasons, accessible MP4/HLS and subtitles |
| [KissKH](kisskh/README.md)     | Native 0.1.0; live checks pass       | Asian Movies/TV, four collections, direct video and plain subtitles  |
| Pinoymoviepedia                | Candidate; not packaged or verified  | Filipino Movies/TV                                                   |

The optional `registry.json` lists implemented extensions only. Its manifests and
payloads point at tested commits. Add its HTTPS URL under **Extensions →
Registries**, then review a source before installing. No CloudStream runtime or
`.cs3`/`.jar` package is needed. Each future source keeps its own IDs, parsing,
sessions and host grants while sharing Vestra's player and progress system.

Source registry URL:

```text
https://raw.githubusercontent.com/amabee/Vestra/main/extensions/registry.json
```

MovieBox needs a Vestra build supporting SDK 1.4's source-session permission.
Its guest samples returned SD; locked HD tracks are not offered. See the
[implementation and verification report](../docs/moviebox-source.md).
