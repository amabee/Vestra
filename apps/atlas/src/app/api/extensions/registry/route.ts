import { parseRegistry } from "@vestra/provider-sdk";
import { getSettings, saveSettings } from "@vestra/storage";
import { NextResponse } from "next/server";
import { z } from "zod";

import { safeFetchText, UnsafeUrlError } from "@/lib/safe-fetch";
import { getDriver } from "@/lib/storage";

import { blockedOnWeb } from "../guard";

/**
 * Extension registry index.
 *
 * The registry is fetched server-side so the browser never talks to the
 * third-party host directly (no CORS dance, no request leaking the user's IP
 * to the index), and so the document is validated before any of it reaches
 * the UI.
 */

export const dynamic = "force-dynamic";

const urlSchema = z.object({ url: z.string().url().max(2048) });

export async function GET(request: Request) {
  const blocked = blockedOnWeb();
  if (blocked) return blocked;

  const url = new URL(request.url).searchParams.get("url");

  const parsed = urlSchema.safeParse({ url });
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid registry URL is required." }, { status: 400 });
  }

  let raw: string;
  try {
    raw = await safeFetchText(parsed.data.url, { accept: "application/json" });
  } catch (error) {
    const message =
      error instanceof UnsafeUrlError
        ? error.message
        : "Could not reach that registry.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "That URL did not return valid JSON." },
      { status: 502 },
    );
  }

  // Registries in the wild use either a bare array or { extensions: [...] }.
  const list = Array.isArray(document)
    ? document
    : ((document as { extensions?: unknown })?.extensions ?? null);

  const { entries, rejected } = parseRegistry(list);

  if (entries.length === 0) {
    return NextResponse.json(
      { error: "No usable extensions were found at that URL." },
      { status: 502 },
    );
  }

  return NextResponse.json({ url: parsed.data.url, entries, rejected });
}

/** Add a registry URL to settings. */
export async function POST(request: Request) {
  const blocked = blockedOnWeb();
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = urlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid registry URL is required." }, { status: 400 });
  }

  const driver = getDriver();
  const settings = await getSettings(driver);
  const existing = settings.extensions.registries;

  const registries = existing.includes(parsed.data.url)
    ? existing
    : [...existing, parsed.data.url];

  const updated = await saveSettings(driver, {
    ...settings,
    extensions: { ...settings.extensions, registries },
  });

  return NextResponse.json({ registries: updated.extensions.registries });
}

/** Remove a registry URL from settings. */
export async function DELETE(request: Request) {
  const blocked = blockedOnWeb();
  if (blocked) return blocked;

  const url = new URL(request.url).searchParams.get("url");

  const parsed = urlSchema.safeParse({ url });
  if (!parsed.success) {
    return NextResponse.json({ error: "A valid registry URL is required." }, { status: 400 });
  }

  const driver = getDriver();
  const settings = await getSettings(driver);

  const updated = await saveSettings(driver, {
    ...settings,
    extensions: {
      ...settings.extensions,
      registries: settings.extensions.registries.filter(
        (entry) => entry !== parsed.data.url,
      ),
    },
  });

  return NextResponse.json({ registries: updated.extensions.registries });
}
