# Goja and Seanime port status

**The Goja engine has not been ported. Full Seanime extension-host parity is not complete.**
Vestra runs JavaScript in Jint, a C# interpreter, and implements selected Seanime
host APIs around it. TypeScript is preprocessed by Nova's trusted TypeScript
compiler. This is a runtime replacement and compatibility implementation, not a
Go-to-C# translation of Goja. No Go runtime is required by the C# provider worker.

The worker `capabilities` command reports this distinction and its implemented
surface in machine-readable form. No single successful provider establishes
complete compatibility.

The worker implements the manga-provider method set; Nova also has a preview
reader, guarded image delivery and persisted reading progress. See
[manga-provider-status.md](manga-provider-status.md) for its current contract,
live metadata checks and reader/UI limits. This supersedes the earlier
online-stream-only checkpoint in the table below.

| Area               | Current implementation                                                                          | Remaining work                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Engine             | Jint 4.17.0; call budgets; JSON boundary                                                        | Goja-specific semantics, broad parity corpus and throughput benchmarks                           |
| Streaming contract | search, findEpisodes, findEpisodeServer, getSettings                                            | Full AniList context, remote installer/updater and clean-machine verification                    |
| Fetch              | Guarded HTTPS transport; text bodies, JSON, URL-encoded forms and multipart text                | Binary payloads, per-fetch AbortSignal, concurrent scheduling, full cookie/header semantics      |
| Responses          | Synchronous text/json (await also works), statusText, headers map/get                           | Complete Seanime response surface and binary data                                                |
| HTML               | Read-only AngleSharp selection subset                                                           | Remaining goquery traversal and callback edge semantics                                          |
| Binary and URL     | Bounded Buffer and HTTP(S) URL/query subsets                                                    | Full Node/WHATWG compatibility                                                                   |
| Crypto             | AES-CBC, hash and encoder subsets                                                               | Remaining hashes, HMAC and exact upstream WordArray/byte-array shapes                            |
| State              | Per-provider atomic JSON store, C# reading progress with legacy import, preferences from config | Complete preference lifecycle, Seanime database import and multiprocess ownership                |
| TypeScript         | Syntax diagnostics and preprocessing; global Provider scripts                                   | Modules and runtime import policy                                                                |
| Worker lifecycle   | Private stdio, cancellation deadline, restart/reload on next request                            | Clean-machine install and visual lifecycle checks; no OS sandbox is claimed                      |
| Extension kinds    | Online-stream and manga worker contracts; preview manga reader                                  | Manga ranking/downloads/visual QA, anime torrents, custom sources, plugin hooks and app services |
| Other bindings     | Explicitly unavailable                                                                          | ChromeDP/browser observation, timers, scanner/torrent helpers and remaining global APIs          |
| Playback           | Opaque handles, lazy resolution, mpv headers/subtitle URLs                                      | Live visual end-to-end checks, source health UI, broader media fixtures                          |

The response audit found that Seanime returns body methods synchronously. The
initial Vestra implementation incorrectly returned promises. It now matches
the synchronous contract, including JSON/null behavior for invalid JSON, while
still supporting callers that use await. Request-body and header fixtures cover
this behavior separately from script compilation.

The Nova session restarts a failed worker on the next request and reloads only
successfully loaded definitions. It does not retry the interrupted call. A process
test confirms that persistence survives cancellation and reload, and that the
cancelled pending Promise is not replayed. Intentional shutdown remains final.

Validation in this pass: 53 self-contained/runtime test cases (external-source
checks are opt-in), three worker process tests, TypeScript checks and Electron
build. The latest live report remains a separate source-specific observation;
manifest verification does not establish visual playback or overall parity.

The broader C# rewrite also remains incomplete: library/database migration,
accounts and catalogue services, downloads/debrid/torrents, manga and other
Seanime subsystems are tracked in [csharp-migration.md](csharp-migration.md).
