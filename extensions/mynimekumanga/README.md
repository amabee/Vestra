# MyNimeKu (Indonesian Manga)

Native SDK 1.6 port of `src/manga/mynimekumanga/provider.js` at Seanime Providers commit `60f46c873d20efcb977eaf8a010672fe526db229`. MIT; see third-party notices. Reads the public page's search nonce rather than copying an expiring nonce into the extension. The source's live-search API only advertises additional pages when it returns `has_more`; this extension does not invent pagination. No local challenge-solver or account credentials are used.
