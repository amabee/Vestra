import {
  getWatchlist,
  removeFromWatchlist,
  toggleWatchlist,
} from "@vestra/storage";
import { mediaItemSchema, mediaRefSchema } from "@vestra/types";
import { NextResponse } from "next/server";

import { getDriver } from "@/lib/storage";

/** Watchlist persistence. Backed by the local JSON store. */

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await getWatchlist(getDriver());
  return NextResponse.json({ entries });
}

/** POST toggles membership, so the UI needs a single endpoint for the star button. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = mediaItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid media item.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await toggleWatchlist(getDriver(), parsed.data);
  return NextResponse.json({
    inWatchlist: result.inWatchlist,
    entries: result.entries,
  });
}

export async function DELETE(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = mediaRefSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid media reference." }, { status: 400 });
  }

  const entries = await removeFromWatchlist(getDriver(), parsed.data);
  return NextResponse.json({ entries });
}
