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

  // `sourceUrl` lives on the details payload and drives the external fallback.
  const details = await getMediaDetails(parsedSource.data, parsedKind.data, sourceId).catch(
    () => null,
  );

  const sources = await resolvePlaybackSources({
    source: parsedSource.data,
    kind: parsedKind.data,
    sourceId,
    sourceUrl: details?.sourceUrl ?? null,
  });

  return NextResponse.json({ sources });
}
