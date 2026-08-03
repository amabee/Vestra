import { getSettings, saveSettings } from "@vestra/storage";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDriver } from "@/lib/storage";

import { blockedOnWeb } from "../guard";

/**
 * Installed extension ids.
 *
 * Only ids are persisted; everything else is resolved from the registry at
 * render time, so a stale copy of an extension's metadata can never drift out
 * of sync with what the registry actually serves.
 */

export const dynamic = "force-dynamic";

const idSchema = z.object({ id: z.string().min(1).max(200) });

export async function GET() {
  const blocked = blockedOnWeb();
  if (blocked) return blocked;

  const settings = await getSettings(getDriver());
  return NextResponse.json({ installed: settings.extensions.enabled });
}

export async function POST(request: Request) {
  const blocked = blockedOnWeb();
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = idSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "An extension id is required." }, { status: 400 });
  }

  const driver = getDriver();
  const settings = await getSettings(driver);
  const current = settings.extensions.enabled;

  const enabled = current.includes(parsed.data.id)
    ? current
    : [...current, parsed.data.id];

  const updated = await saveSettings(driver, {
    ...settings,
    extensions: { ...settings.extensions, enabled },
  });

  return NextResponse.json({ installed: updated.extensions.enabled });
}

export async function DELETE(request: Request) {
  const blocked = blockedOnWeb();
  if (blocked) return blocked;

  const id = new URL(request.url).searchParams.get("id");

  const parsed = idSchema.safeParse({ id });
  if (!parsed.success) {
    return NextResponse.json({ error: "An extension id is required." }, { status: 400 });
  }

  const driver = getDriver();
  const settings = await getSettings(driver);

  const updated = await saveSettings(driver, {
    ...settings,
    extensions: {
      ...settings.extensions,
      enabled: settings.extensions.enabled.filter((entry) => entry !== parsed.data.id),
    },
  });

  return NextResponse.json({ installed: updated.extensions.enabled });
}
