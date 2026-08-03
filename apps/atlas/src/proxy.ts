import { NextResponse, type NextRequest } from "next/server";

/**
 * Host gate for desktop-only routes.
 *
 * Atlas is one codebase serving two hosts. Extensions belong to Nova, so on
 * the web these routes must not exist at all.
 *
 * The page and the route handlers each perform their own check, but a
 * `force-dynamic` page has already flushed its response head by the time
 * `notFound()` throws — the browser gets a 404 body under a 200 status.
 * Deciding at the network boundary, before rendering starts, is what makes it
 * a real 404. The matcher stays narrow so this never becomes a tax on every
 * request in the app.
 */
export const config = {
  matcher: ["/extensions", "/extensions/:path*", "/api/extensions/:path*"],
};

export function proxy(request: NextRequest): NextResponse {
  if (process.env.VESTRA_HOST === "desktop") return NextResponse.next();

  // API callers get JSON; a browser gets Next's own not-found page.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
}
