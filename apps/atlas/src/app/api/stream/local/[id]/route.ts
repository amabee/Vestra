import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { getLocalFiles } from "@vestra/storage";
import { NextResponse } from "next/server";

import { getDriver } from "@/lib/storage";

/**
 * GET /api/stream/local/:id
 *
 * Streams a scanned local file with HTTP range support so the browser can seek.
 *
 * SECURITY: the `id` is looked up in the library index and the stored absolute
 * path is used verbatim. No part of the request ever reaches the filesystem as
 * a path, which is what prevents traversal — an unknown id simply 404s.
 */

export const dynamic = "force-dynamic";

const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  ts: "video/mp2t",
};

function mimeFor(extension: string): string {
  return MIME_TYPES[extension.toLowerCase()] ?? "application/octet-stream";
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;

  const files = await getLocalFiles(getDriver());
  const file = files.find((entry) => entry.id === decodeURIComponent(id));

  if (!file) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let size: number;
  try {
    const stats = await stat(file.path);
    if (!stats.isFile()) {
      return NextResponse.json({ error: "Not a file." }, { status: 404 });
    }
    size = stats.size;
  } catch {
    // Indexed but since moved or deleted.
    return NextResponse.json({ error: "File is no longer available." }, { status: 410 });
  }

  const contentType = mimeFor(file.extension);
  const range = request.headers.get("range");

  // Full-content request.
  if (!range) {
    const stream = Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
      },
    });
  }

  // Range request — e.g. "bytes=1024-" or "bytes=0-2047".
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  const [, rawStart, rawEnd] = match;
  const start = rawStart ? Number.parseInt(rawStart, 10) : 0;
  const end = rawEnd ? Math.min(Number.parseInt(rawEnd, 10), size - 1) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  const stream = Readable.toWeb(
    createReadStream(file.path, { start, end }),
  ) as ReadableStream<Uint8Array>;

  return new NextResponse(stream, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    },
  });
}
