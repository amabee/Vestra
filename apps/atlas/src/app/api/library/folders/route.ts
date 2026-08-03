import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

import { getSettings, saveSettings } from "@vestra/storage";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getDriver } from "@/lib/storage";

/**
 * Media folder management.
 *
 * Adding a folder is the one place a user-supplied path enters the system, so
 * it is validated here — absolute, existing, and a directory — and then only
 * ever read back from settings by the scanner.
 */

export const dynamic = "force-dynamic";

const addFolderSchema = z.object({
  path: z.string().min(1).max(4096),
  label: z.string().max(120).nullable().default(null),
});

const removeFolderSchema = z.object({ id: z.string().min(1) });

export async function GET() {
  const settings = await getSettings(getDriver());
  return NextResponse.json({ folders: settings.library.folders });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = addFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid folder payload." }, { status: 400 });
  }

  const resolved = path.resolve(parsed.data.path);

  // Reject anything that is not a real, readable directory up front, so the
  // scanner never has to deal with a bad root.
  if (!path.isAbsolute(resolved)) {
    return NextResponse.json({ error: "Path must be absolute." }, { status: 400 });
  }

  try {
    const stats = await stat(resolved);
    if (!stats.isDirectory()) {
      return NextResponse.json({ error: "That path is not a folder." }, { status: 400 });
    }
  } catch {
    return NextResponse.json(
      { error: "That folder does not exist or cannot be read." },
      { status: 400 },
    );
  }

  const driver = getDriver();
  const settings = await getSettings(driver);

  if (settings.library.folders.some((folder) => path.resolve(folder.path) === resolved)) {
    return NextResponse.json({ error: "That folder is already added." }, { status: 409 });
  }

  const updated = await saveSettings(driver, {
    ...settings,
    library: {
      ...settings.library,
      folders: [
        ...settings.library.folders,
        {
          id: randomUUID(),
          path: resolved,
          label: parsed.data.label,
          enabled: true,
          lastScannedAt: null,
          fileCount: 0,
        },
      ],
    },
  });

  return NextResponse.json({ folders: updated.library.folders });
}

export async function DELETE(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = removeFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid folder id." }, { status: 400 });
  }

  const driver = getDriver();
  const settings = await getSettings(driver);

  const updated = await saveSettings(driver, {
    ...settings,
    library: {
      ...settings.library,
      folders: settings.library.folders.filter((folder) => folder.id !== parsed.data.id),
    },
  });

  return NextResponse.json({ folders: updated.library.folders });
}
