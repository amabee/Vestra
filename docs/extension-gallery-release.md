# Extension gallery release — Nova 0.1.2

Built 2026-11-01 from application source `70cf737`.

- Installer: `apps/nova/release/Vestra Nova Setup 0.1.2.exe`
- Size: 167,186,577 bytes
- SHA256: `2A08D2DD914DA2744C1D14DA787AB9E62F9F6325BB024AA955CA336A4FC69027`
- Packaging: Windows x64 NSIS, normal compression override; source configuration remains unchanged.

## Changes

Browse shows square extension cards, registry artwork with monogram fallbacks,
a primary Install action and secondary Review disclosure. Expanded reviews grow
the card instead of overflowing. Installed native extensions also have artwork
cards; compatibility cards reuse available registry logos. Native manifests and
SDK types accept an optional HTTPS `icon` URL.

Descriptions advertising Seanime receive neutral category summaries in the UI.
Original author credits, registry records, compatibility identities and notices
remain intact. This is a presentation change, not a native provider replacement.
Existing sources and saved progress remain available. Native replacements and
Films UI work remain separate follow-ups.

## Verification

- Nova typecheck and production Electron/renderer builds pass.
- Extension-host suite: 128 existing tests pass; focused pipeline suite with the
  new artwork validation case: 30 tests pass. Extension-host typecheck passes.
- Installer preparation: four tests pass, including direct manifest detection.
- Hidden anime/extension UI fixtures: 13 scenario groups pass, including
  permission review before installation, retained author credits, missing-logo
  fallback, expanded review sizing and desktop/mobile gallery bounds.
- Screenshots inspected at 1200 and 375 pixels wide using controlled fixtures.
- Packaged worker smoke: three top-level tests pass, including its five-case
  SDK-hidden worker suite.
- Packaged ASAR main, preload, renderer entry and referenced JavaScript/CSS assets
  byte-match the final build; packaged version is 0.1.2.

The installer was generated without installing over the user's app. A clean-machine
install and live provider replacement checks are not claimed by these fixtures.
