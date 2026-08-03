import { universalSearch } from "@vestra/core/search";
import { searchQuerySchema } from "@vestra/types";
import { NextResponse } from "next/server";

import { getDriver } from "@/lib/storage";

/**
 * GET /api/search?q=...
 *
 * Universal search across every configured provider. Runs on the server so
 * provider credentials are never exposed to the browser.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);

  const parsed = searchQuerySchema.safeParse({
    query: url.searchParams.get("q") ?? "",
    sources: url.searchParams.getAll("source"),
    kinds: url.searchParams.getAll("kind"),
    page: Number(url.searchParams.get("page") ?? 1),
    perPage: Number(url.searchParams.get("perPage") ?? 20),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid search query.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const results = await universalSearch(parsed.data, { driver: getDriver() });
    return NextResponse.json(results);
  } catch (error) {
    // Per-provider failures are already handled inside universalSearch, so
    // reaching here means something unexpected broke.
    console.error("[api/search] unexpected failure", error);
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
