import { listInstalled, removeInstalled } from "@vestra/extension-host";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDriver } from "@/lib/storage";

import { blockedOnWeb } from "../guard";

/**
 * Installed community extensions.
 *
 * Records live in their own store rather than in settings: an install carries a
 * permission grant, an integrity fingerprint and provenance, none of which is a
 * preference. Installing happens through `/api/extensions/install`, which is
 * two-phase; this endpoint only lists and removes.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = blockedOnWeb();
  if (blocked) return blocked;

  const installed = await listInstalled(getDriver());
  return NextResponse.json({ installed });
}

export async function DELETE(request: Request) {
  const blocked = blockedOnWeb();
  if (blocked) return blocked;

  const id = new URL(request.url).searchParams.get("id");

  const parsed = z.object({ id: z.string().min(1).max(200) }).safeParse({ id });
  if (!parsed.success) {
    return NextResponse.json({ error: "An extension id is required." }, { status: 400 });
  }

  const installed = await removeInstalled(getDriver(), parsed.data.id);
  return NextResponse.json({ installed });
}
