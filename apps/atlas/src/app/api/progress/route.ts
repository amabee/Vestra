import { getAllProgress, getSettings, saveProgress } from "@vestra/storage";
import { mediaRefSchema } from "@vestra/types";
import { NextResponse } from "next/server";
import { z } from "zod";

/** Watch progress — drives resume and Continue Watching. */

import { getDriver } from "@/lib/storage";

export const dynamic = "force-dynamic";

const saveProgressSchema = z.object({
  ref: mediaRefSchema,
  episodeId: z.string().nullable().default(null),
  positionSeconds: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
});

export async function GET() {
  const entries = await getAllProgress(getDriver());
  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = saveProgressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid progress payload.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const driver = getDriver();
  // Respect the user's "mark watched at" threshold rather than hard-coding 90%.
  const settings = await getSettings(driver);

  const progress = await saveProgress(driver, {
    ...parsed.data,
    markWatchedAt: settings.playback.markWatchedAt,
  });

  return NextResponse.json({ progress });
}
