import { qbittorrent, toProviderMessage } from "@vestra/api";
import { isQbittorrentConfigured } from "@vestra/config";
import { addTorrentInputSchema } from "@vestra/types";
import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * qBittorrent transfer control.
 *
 * Proxies to the user's own qBittorrent Web API. Credentials stay server-side;
 * the browser never talks to the client directly.
 */

export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum(["pause", "resume", "delete"]),
  hashes: z.array(z.string().min(1)).min(1),
  deleteFiles: z.boolean().default(false),
});

export async function GET() {
  if (!isQbittorrentConfigured()) {
    return NextResponse.json(
      { configured: false, torrents: [], status: null },
      { status: 200 },
    );
  }

  try {
    const [status, torrents] = await Promise.all([
      qbittorrent.getQbittorrentStatus(),
      qbittorrent.listTorrents(),
    ]);

    return NextResponse.json({ configured: true, status, torrents });
  } catch (error) {
    return NextResponse.json(
      { configured: true, error: toProviderMessage(error), torrents: [] },
      { status: 502 },
    );
  }
}

/** POST adds a transfer; PATCH performs pause/resume/delete actions. */
export async function POST(request: Request) {
  if (!isQbittorrentConfigured()) {
    return NextResponse.json({ error: "qBittorrent is not configured." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = addTorrentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid transfer payload.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await qbittorrent.addTorrent(parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: toProviderMessage(error) }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  if (!isQbittorrentConfigured()) {
    return NextResponse.json({ error: "qBittorrent is not configured." }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid action payload." }, { status: 400 });
  }

  const { action, hashes, deleteFiles } = parsed.data;

  try {
    if (action === "pause") await qbittorrent.pauseTorrents(hashes);
    else if (action === "resume") await qbittorrent.resumeTorrents(hashes);
    else await qbittorrent.deleteTorrents(hashes, deleteFiles);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: toProviderMessage(error) }, { status: 502 });
  }
}
