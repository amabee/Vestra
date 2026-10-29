# Native subtitle metadata

Subtitle URL, language, optional title and default selection now survive the C#
provider and extension-host schemas, rendition selection and main-process playback
boundary. C# adapters supply an ID when a provider omits it. The worker rejects
malformed title/default/language metadata and limits tracks to 50 per rendition.

After its video emits file-loaded, the session checks the current path and adds
external tracks with `sub-add URL flags title language`. Titles fall back to the
provider's language label when absent. Duplicate URLs are suppressed, and the
first declared default is selected last so other additions do not override it.
The command argument contract and selection flags follow the
[official mpv track-manipulation reference](https://mpv.io/manual/stable/#track-manipulation).

Video loads and subtitle additions share a session lane. Generation/path checks
discard stale file events and remaining subtitle work when another file opens or
playback closes. Main also discards outdated asynchronous open requests. Every
video load resets HTTP headers and legacy sub-files; external subtitles are added
once with their metadata rather than being duplicated as anonymous sub-files.

Track-list updates carry native title/language to the controls menu. A subtitle
failure is reported separately and does not mark video playback as failed; other
tracks continue loading. The warning appears with the visible player controls.
Stopping or loading another file clears the warning and previous track state.

Five background metadata/loader tests cover both host boundaries, exact native
command arguments, defaults, duplicate URLs, wrong-path events, cancellation and
isolated failures. Two .NET metadata cases cover preservation and malformed input.
Together with the existing suite, 78 .NET cases pass. Type checks and builds pass.
The earlier native mpv fixture has not been rerun against this new loading path,
and actual playback/track-menu verification remains deferred. The installer still
needs refreshing before those checks. No full Seanime parity is claimed.
