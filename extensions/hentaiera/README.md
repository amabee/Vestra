# HentaiEra

Native Vestra manga source. Requires a Nova build supporting `searchPage` (SDK 1.6). Search, chapters and images use reviewed network grants.

This is an independent MIT implementation for Foundry, based on the public site's HTML formats. It does not copy the unlicensed ASleepyDrink/Seanime-Stuff scripts. The Seanime source was suggested by the user as a compatibility reference.

ID: `vestra-hentaiera`. It can coexist with the previous C# compatibility import; existing compatibility reading progress stays associated with that import.

Search pages follow the site's pagination links. Site errors and browser-verification requirements are surfaced rather than converted into empty results. Images are fetched by Vestra's guarded image broker. No browser cookies or user credentials are imported.

Search form and reader metadata were checked against live HTML; no image pages were downloaded for publication verification. The observed image servers are m4.hentaiera.com and m11.hentaiera.com. Other image servers require a reviewed host-grant update.
