import { mediaKindSchema, mediaSourceSchema } from "@vestra/types";
import { NextResponse } from "next/server";

import { getMediaDetails } from "@/lib/media";

/**
 * GET /api/media/:source/:kind/:id
 *
 * Full details for one item. Backs the right-hand details panel, which needs
 * studios, seasons and cast that the lightweight MediaItem doesn't carry.
 */

export const dynamic = "force-dynamic";

interface RouteContext {
  // Next 16 delivers route params asynchronously.
  params: Promise<{ source: string; kind: string; id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { source, kind, id } = await context.params;

  const parsedSource = mediaSourceSchema.safeParse(source);
  const parsedKind = mediaKindSchema.safeParse(kind);

  if (!parsedSource.success || !parsedKind.success) {
    return NextResponse.json({ error: "Unknown source or kind." }, { status: 400 });
  }

  try {
    const details = await getMediaDetails(
      parsedSource.data,
      parsedKind.data,
      decodeURIComponent(id),
    );

    if (!details) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    return NextResponse.json({ details });
  } catch {
    return NextResponse.json({ error: "Could not load details." }, { status: 502 });
  }
}
