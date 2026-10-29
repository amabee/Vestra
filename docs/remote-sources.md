# Remote provider installs and updates

Sources accepts an HTTPS manifest URL. Preview downloads bounded UTF-8 manifest
and script bytes through the existing C# public-address-pinned HTTPS transport.
Each request has the existing deadline/redirect rules and 2 MiB transport cap;
manifest and script acceptance limits are 64 KiB and 1 MiB respectively. Credentials,
fragments and non-443 ports are rejected. The private download command is not
available inside guest JavaScript.

The manifest supports Seanime-style `id`, `name`, `type`, `version`, `payloadURI`
and optional `language` (`javascript`/`typescript`). Supported types are anime
online-stream and manga providers. Optional `hosts`, `preferences`, `compatibility`,
`preferredServer` and hexadecimal `sha256` fields are understood. The user-entered
manifest URL remains the update origin; a manifest's `manifestURI` cannot replace it.

```json
{
  "id": "example",
  "name": "Example manga",
  "type": "manga-provider",
  "version": "1.0.0",
  "language": "typescript",
  "payloadURI": "https://example.org/provider.ts",
  "hosts": ["manga.example.org"]
}
```

Preview does not execute guest code. It shows source identity, version, download
locations and requested websites. The user reviews/edits the exact granted hosts
before installing. If SHA256 is declared, raw downloaded bytes must match it;
otherwise the observed fingerprint pins those bytes to the review. This is not a
publisher signature or authenticity guarantee. Prepared copies expire after ten
minutes, at most four are retained, and applying does not re-download changed code.

Remote sources show their installed version and **Check for updates**. Checks are
manual and read-only. A different version or changed bytes at the same version
produces a review; versions are opaque labels, so a publisher's downgrade is also
shown rather than silently treated as an upgrade. Update identity/type/origin are
fixed. Approved hosts may change; current name, preferences, compatibility profile,
preferred server, enabled state and data identity are preserved. Stale reviews are
rejected. Enabled updates use the existing load/settings validation and failure
restoration; disabled updates remain inactive until enabled.

Each successful replacement retains up to three previous script snapshots in the
same atomic registry record, including its remote origin/version. **Previous
scripts → Restore** selects one. Restore keeps current settings and host grants,
validates enabled scripts and retains the outgoing script, allowing reversal.
An older script incompatible with the current preferred server fails validation;
configure that preference first. History survives restart. Guest provider-store
side effects during validation are not rolled back. A successful local replacement
clears its current remote version/origin; restoring its remote snapshot restores
that association.

Verification: five fixture-backed remote workflow tests, eleven existing management
tests and five worker protocol tests pass, along with type checks/builds. Coverage
includes checksum mismatch, byte limits, unsafe URLs, staged-byte pinning, changed
identity, expiry, stale updates, same-version drift, retained settings and bounded
history/restore. Worker tests also reject HTTP and loopback artifact URLs using the
real guarded transport. No native UI or live remote-install test was performed in
this pass; installer refresh and desktop verification remain deferred.
