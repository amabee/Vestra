# Packaged desktop observations

Date: 2026-10-29. Used the Windows x64 unpacked application through the Windows
computer-use helper, with a new `--user-data-dir` profile under the system temp
directory. Its cache and `data` directories were verified under that separate
profile. The user's normal library/settings profile was not used for these checks.
This machine has .NET installed, so this is not clean-machine verification.

Observed:

- The packaged home and Sources screens rendered.
- The native Import provider script chooser opened and accepted the local
  MangaStash `provider.js` file.
- Source ID, name, content type and exact website settings were entered; the
  installed source displayed Loaded, backed by the packaged C# worker.
- A Solo search was issued; the reader subsequently displayed Solo Leveling,
  chapter 1, with 212 chapters and 80 pages in that chapter.
- Page 1 decoded visibly, including its rendered speech bubble. This establishes
  actual image rendering rather than only an HTTP success or MIME check.
- The separate profile's C# progress file recorded chapter
  `solo-leveling/chapter-1`, ordinal page `0` after image decode.

The helper reported that the user stopped Computer Use with physical Escape when
the next-page action was attempted. No further computer-use calls were made.
The page-change outcome was not verified. Restart/resume, chapter navigation,
source configuration/error/recovery flows and actual video playback remain open.

The user subsequently requested background development while gaming. Desktop
interaction and installer rebuilding are deferred. Continue Reading, chapter
navigation and advanced reader controls added afterward are source changes with
automated checks; this observation does not establish their visual correctness.
