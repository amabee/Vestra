import { NextResponse } from "next/server";

import { extensionsEnabled } from "@/lib/host";

/**
 * Desktop-only gate for the extension endpoints.
 *
 * Returns a 404 rather than a 403: on the web these routes should look like
 * they were never built, not like something the caller is being kept out of.
 */
export function blockedOnWeb(): NextResponse | null {
  if (extensionsEnabled()) return null;
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}
