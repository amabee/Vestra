# AsuraScans

Native SDK 1.6 adaptation of Seanime Providers' `src/manga/asurascans/provider.js` at commit `60f46c873d20efcb977eaf8a010672fe526db229`. MIT; see third-party notices. Astro props are decoded as data; remote scripts are never executed. Chapter paths are restricted to the selected comic. Upstream availability is recorded separately in `manga-ports.json` and the registry.

Source-declared premium/early-access chapters are labelled in the chapter list and return an explicit availability message. Locked chapters provide no public image list; the adapter does not attempt to unlock them. Unlocked chapters continue through the normal reader.
