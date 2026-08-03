import { matchLibrary } from "@vestra/providers/matcher";
import { scanLibrary } from "@vestra/providers/scanner";
import { getSettings } from "@vestra/storage";
import { NextResponse } from "next/server";

import { getProviderRegistry } from "@/lib/registry";
import { getDriver } from "@/lib/storage";

/**
 * POST /api/library/scan
 *
 * Walks the folders saved in Settings, indexes video files, then optionally
 * matches them to catalogue entries so they become playable from an AniList or
 * TMDb page.
 *
 * The request body carries NO paths — only the roots stored in settings are
 * ever traversed, which is what keeps this from being an arbitrary-read hole.
 */

export const dynamic = "force-dynamic";
// Scanning a large library and matching over a rate-limited API takes a while.
export const maxDuration = 300;

export async function POST() {
  const driver = getDriver();
  const settings = await getSettings(driver);

  if (settings.library.folders.length === 0) {
    return NextResponse.json(
      { error: "No media folders configured. Add one in Settings first." },
      { status: 409 },
    );
  }

  try {
    const scan = await scanLibrary(driver, settings.library);

    let matched = 0;
    let unmatched = scan.files.length;

    if (settings.library.autoMatchMetadata && scan.files.length > 0) {
      const result = await matchLibrary(driver, getProviderRegistry());
      matched = result.matched;
      unmatched = result.unmatched;
    }

    return NextResponse.json({
      scanned: scan.scanned,
      added: scan.added,
      removed: scan.removed,
      matched,
      unmatched,
      errors: scan.errors,
    });
  } catch (error) {
    console.error("[api/library/scan] failed", error);
    return NextResponse.json({ error: "Scan failed." }, { status: 500 });
  }
}
