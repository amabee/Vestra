# MangaBuddy (MangaK)

Native Vestra SDK 1.6 manga source. The Seanime provider named MangaBuddy currently targets `mangak.io` and `api.mangak.io`; this port preserves that backend and makes it explicit in the display name.

Search uses the server's real pagination. Title IDs exclude the changing cache-version timestamp so saved progress survives later searches. Chapters preserve decimal numbers and unnumbered specials without inventing completion numbers. Reader metadata is parsed as JSON; remote scripts are never executed. Image requests use reviewed exact hosts and the source referer.

Adapted from `src/manga/mangabuddy/provider.js` at Seanime-contributions/Seanime-Providers commit `60f46c873d20efcb977eaf8a010672fe526db229`, under MIT. See the repository's third-party notices.
