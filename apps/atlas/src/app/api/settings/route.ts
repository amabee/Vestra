import { getSettings, saveSettings } from "@vestra/storage";
import { settingsSchema } from "@vestra/types";
import { NextResponse } from "next/server";

import { getDriver } from "@/lib/storage";

/** Read and update the stored settings document. */

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings(getDriver());
  return NextResponse.json({ settings });
}

/**
 * PATCH merges a partial document. The merge is section-wise so a client can
 * send just `{ playback: {...} }` without clobbering the other sections.
 */
export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const driver = getDriver();
  const current = await getSettings(driver);

  const patch = body as Partial<Record<keyof typeof current, Record<string, unknown>>>;

  const merged = settingsSchema.safeParse({
    ...current,
    ...Object.fromEntries(
      Object.entries(patch).map(([section, value]) => [
        section,
        typeof value === "object" && value !== null
          ? { ...(current[section as keyof typeof current] as object), ...value }
          : value,
      ]),
    ),
  });

  if (!merged.success) {
    return NextResponse.json(
      { error: "Invalid settings payload.", issues: merged.error.issues },
      { status: 400 },
    );
  }

  const settings = await saveSettings(driver, merged.data);
  return NextResponse.json({ settings });
}
