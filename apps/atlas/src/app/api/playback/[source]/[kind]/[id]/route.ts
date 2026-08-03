import { mediaKindSchema, mediaSourceSchema } from "@vestra/types";
import { NextResponse } from "next/server";

import { getMediaDetails } from "@/lib/media";
import { resolvePlaybackSources } from "@/lib/playback";

/**
 * GET /api/playback/:source/:kind/:id
 *
 * Returns the playable sources for an item, best first. An empty list (or one
 * containing only `external`) means Vestra cannot play it in-app.
 */

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ source: string; kind: string; id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { source, kind, id } = await context.params;

  const parsedSource = mediaSourceSchema.safeParse(source);
  const parsedKind = mediaKindSchema.safeParse(kind);

  if (!parsedSource.success || !parsedKind.success) {
    return NextResponse.json({ error: "Unknown source or kind." }, { status: 400 });
  }

  const sourceId = decodeURIComponent(id);

  // Adapters inspect the whole item (kind, sourceUrl, source) to decide whether
  // they can help, so the full details payload is required here.
  const details = await getMediaDetails(parsedSource.data, parsedKind.data, sourceId).catch(
    () => null,
  );

  if (!details) {
    return NextResponse.json({ sources: [] });
  }

  const sources = await resolvePlaybackSources(details);

  return NextResponse.json({ sources });
}
