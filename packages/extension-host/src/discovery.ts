import { z } from "zod";

export const discoveryCategorySchema = z.enum([
  "suggested",
  "ongoing",
  "latest",
  "upcoming",
  "popular",
]);
export type DiscoveryCategory = z.infer<typeof discoveryCategorySchema>;
export function assertDiscoveryMethods(
  declared: boolean,
  methods: readonly string[],
): void {
  if (declared && !methods.includes("browse"))
    throw new Error("Discovery categories require a browse() method.");
}
export const discoveryManifestSchema = z.object({
  categories: z
    .array(discoveryCategorySchema)
    .min(1)
    .max(5)
    .refine(
      (rows) => new Set(rows).size === rows.length,
      "Duplicate discovery category",
    ),
});
