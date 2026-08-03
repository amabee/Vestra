import { z } from "zod";

/**
 * The manifest a community extension ships, and the rules it must satisfy
 * before anything is downloaded.
 *
 * `ExtensionManifest` in the provider SDK describes the shape. This adds the
 * part that matters at load time: validation, and the constraints that make a
 * manifest usable as a security document rather than a description.
 */

/** Hostnames only — no scheme, no port, no path, no wildcards. */
const hostSchema = z
  .string()
  .min(1)
  .max(253)
  .toLowerCase()
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    "Must be a bare hostname, e.g. api.example.com",
  );

export const extensionPermissionSchema = z.enum([
  "network",
  "library:read",
  "progress:read",
]);

export const extensionManifestSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(100)
      // Used in storage keys and cache paths; keep it inert.
      .regex(/^[a-zA-Z0-9._-]+$/, "May contain only letters, digits, dot, dash, underscore"),
    name: z.string().min(1).max(120),
    version: z.string().min(1).max(40),
    main: z.string().min(1).max(200),
    sdkVersion: z.string().min(1).max(40),
    permissions: z.array(extensionPermissionSchema).max(8).default([]),
    /**
     * Hosts the extension intends to contact.
     *
     * Declared up front so the grant prompt can name them and the broker can
     * pin them. An extension without this list gets no network, even with the
     * `network` permission — "anywhere" is not a thing to consent to.
     */
    hosts: z.array(hostSchema).max(20).default([]),
    author: z.string().max(120).optional(),
    homepage: z.string().url().optional(),
    description: z.string().max(2000).optional(),
  })
  .superRefine((manifest, ctx) => {
    if (manifest.permissions.includes("network") && manifest.hosts.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["hosts"],
        message: "Requests the network permission but declares no hosts to reach.",
      });
    }

    if (!manifest.permissions.includes("network") && manifest.hosts.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["hosts"],
        message: "Declares hosts but does not request the network permission.",
      });
    }

    // `main` is joined onto the extension root. Anything that can climb out of
    // it is a path traversal waiting to happen.
    if (manifest.main.includes("..") || /^[/\\]/.test(manifest.main)) {
      ctx.addIssue({
        code: "custom",
        path: ["main"],
        message: "Must be a relative path inside the extension.",
      });
    }
  });

export type ValidatedManifest = z.infer<typeof extensionManifestSchema>;

export interface ManifestResult {
  manifest: ValidatedManifest | null;
  errors: string[];
}

export function parseManifest(input: unknown): ManifestResult {
  const parsed = extensionManifestSchema.safeParse(input);

  if (parsed.success) return { manifest: parsed.data, errors: [] };

  return {
    manifest: null,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`,
    ),
  };
}
