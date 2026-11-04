# MangaHub (Russian)

Native Vestra SDK 1.6 port of Seanime Providers' Russian MangaHub.ru extension. This is not the unrelated English MangaHub service. Adapted from `src/manga/mangahub/provider.js` at commit `60f46c873d20efcb977eaf8a010672fe526db229`, MIT; see the repository's third-party notices.

Search preserves the source's result page instead of imposing an 18-item slice. Chapters parse Russian chapter labels and preserve decimal entries. Reader images are extracted only from the reader region and use a chapter-specific referer; advertisements and tracking pixels are excluded.
