import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { getLocalFiles } from "@vestra/storage";
import { protocol } from "electron";

import { getDriver } from "./services";

/**
 * `vestra-media://` — local file playback.
 *
 * The deleted app served local files through an HTTP route with range support.
 * With no server left, the renderer needs another way to reach them, and it
 * cannot simply use `file://`: the renderer is sandboxed, and granting it file
 * access would let any script in it read the user's whole disk.
 *
 * A custom protocol keeps the privilege in the main process. The renderer asks
 * for a file *id*, never a path, and only ids already present in the library
 * index resolve — so a crafted URL cannot walk out of the indexed folders.
 * Range requests are honoured because `<video>` seeking depends on them.
 */

export const MEDIA_SCHEME = "vestra-media";

/**
 * Must run before `app.whenReady()`.
 *
 * `stream: true` is what allows a ReadableStream response, and therefore
 * seeking; without it the whole file would be buffered before playback starts.
 */
export function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: false,
      },
    },
  ]);
}

/** Content types Vestra will serve. Anything else is refused. */
const CONTENT_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  ts: "video/mp2t",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
};

function contentTypeFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/** Parse a single `bytes=start-end` range. Multi-range is not supported. */
function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;

  // `bytes=-500` means the last 500 bytes.
  if (rawStart === "") {
    if (rawEnd === "" || rawEnd === undefined) return null;
    const length = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(length) || length <= 0) return null;
    return { start: Math.max(0, size - length), end: size - 1 };
  }

  const start = Number.parseInt(rawStart ?? "", 10);
  if (!Number.isFinite(start) || start >= size) return null;

  const end =
    rawEnd === "" || rawEnd === undefined
      ? size - 1
      : Math.min(Number.parseInt(rawEnd, 10), size - 1);

  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
}

export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);

    const fileId = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (fileId.length === 0) {
      return new Response("Not found", { status: 404 });
    }

    // vestra-media://thumb/<fileId>
    if (url.hostname === "thumb") {
      return serveThumbnail(fileId);
    }

    // vestra-media://local/<fileId>
    if (url.hostname !== "local") {
      return new Response("Not found", { status: 404 });
    }

    // The library index is the allowlist. A path is never taken from the URL,
    // so there is nothing to traverse out of.
    const files = await getLocalFiles(getDriver());
    const file = files.find((entry) => entry.id === fileId);
    if (!file) return new Response("Not found", { status: 404 });

    let size: number;
    try {
      const stats = await stat(file.path);
      if (!stats.isFile()) return new Response("Not found", { status: 404 });
      size = stats.size;
    } catch {
      // Indexed but since moved or deleted.
      return new Response("Not found", { status: 404 });
    }

    const contentType = contentTypeFor(file.path);
    const range = parseRange(request.headers.get("range"), size);

    if (!range) {
      return new Response(Readable.toWeb(createReadStream(file.path)) as ReadableStream, {
        status: 200,
        headers: {
          "content-type": contentType,
          "content-length": String(size),
          "accept-ranges": "bytes",
        },
      });
    }

    const stream = createReadStream(file.path, { start: range.start, end: range.end });

    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "content-type": contentType,
        "content-length": String(range.end - range.start + 1),
        "content-range": `bytes ${range.start}-${range.end}/${size}`,
        "accept-ranges": "bytes",
      },
    });
  });
}

/**
 * A still frame for an indexed file.
 *
 * The path is read from the library record, never from the URL, so the same
 * allowlist that governs playback governs this. A record can name a file that
 * has since been deleted, which is a 404 rather than an error — the list falls
 * back to showing no image.
 */
async function serveThumbnail(fileId: string): Promise<Response> {
  const files = await getLocalFiles(getDriver());
  const file = files.find((entry) => entry.id === fileId);

  if (!file?.thumbnailPath) return new Response("Not found", { status: 404 });

  try {
    const stats = await stat(file.thumbnailPath);
    if (!stats.isFile()) return new Response("Not found", { status: 404 });

    return new Response(
      Readable.toWeb(createReadStream(file.thumbnailPath)) as ReadableStream,
      {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(stats.size),
          // Regenerated under the same name, so revalidation is worth keeping.
          "cache-control": "no-cache",
        },
      },
    );
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
