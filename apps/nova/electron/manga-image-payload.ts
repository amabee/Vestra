import { z } from "zod";

/** Match the guarded C# image worker, including base64 padding at the boundary. */
export const MAX_MANGA_IMAGE_BYTES = 8 * 1024 * 1024;
export const mangaImagePayloadSchema = z.object({
  mimeType: z.enum([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
  ]),
  data: z
    .string()
    .min(4)
    .max(4 * Math.ceil(MAX_MANGA_IMAGE_BYTES / 3))
    .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .refine((data) => data.length % 4 === 0, "Invalid base64 page image.")
    .refine(
      (data) =>
        (data.length / 4) * 3 -
          (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0) <=
        MAX_MANGA_IMAGE_BYTES,
      "Page image exceeds the 8 MiB limit.",
    ),
});
