import { z } from "zod";

import { mediaKindSchema } from "@vestra/types";

/**
 * Sources described rather than programmed.
 *
 * The isolate exists so untrusted code can run safely. This exists so most
 * contributors never have to write any. Nearly every metadata source is the
 * same shape — call a JSON endpoint, read an array out of the response, copy
 * fields onto a result — and expressing that as a recipe rather than a script
 * costs nothing in capability while removing the entire attack surface: a
 * recipe is data, interpreted by first-party code, so there is nothing to
 * sandbox and nothing that can be obfuscated.
 *
 * That also fixes the review problem. Auditing a JavaScript extension means
 * reading it; auditing a recipe means looking at a URL and a field list.
 *
 * The vocabulary is closed ON PURPOSE. No expressions, no regular expressions,
 * no templating beyond named placeholders. Anything that cannot be said here
 * is a job for a real extension, and the two paths meeting at the same result
 * contract is what keeps that a genuine choice rather than a downgrade.
 */

/* =============================================================================
 * Reading values out of a response
 * ========================================================================== */

/**
 * Segments that would climb the prototype chain.
 *
 * A path comes from a recipe, and a recipe may come from a stranger. Without
 * this, `constructor.prototype.x` reaches objects the response never contained.
 */
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Resolve a dotted path against parsed JSON.
 *
 * Numeric segments index arrays, so `data.0.attributes.title` works. Anything
 * missing yields undefined rather than throwing — a source with patchy data is
 * ordinary, and the field rules below decide whether absence matters.
 */
export function resolveRecipePath(root: unknown, path: string): unknown {
  if (path.length === 0) return root;

  let current: unknown = root;

  for (const segment of path.split(".")) {
    if (FORBIDDEN_SEGMENTS.has(segment)) return undefined;
    if (current === null || current === undefined) return undefined;

    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }

    if (typeof current !== "object") return undefined;

    // Own properties only: inherited members are not response data.
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/* =============================================================================
 * The recipe
 * ========================================================================== */

/**
 * How a raw value becomes a field on a result.
 *
 * Each of these exists because the reference extensions needed it — `year`
 * from an ISO date, `httpsUrl` because the contract refuses plain http,
 * `notEquals` because "is this a series" is usually a subtype comparison.
 */
export const RECIPE_TRANSFORMS = [
  "text",
  "number",
  "year",
  "httpsUrl",
  "boolean",
  "equals",
  "notEquals",
  "textList",
] as const;

export const recipeTransformSchema = z.enum(RECIPE_TRANSFORMS);
export type RecipeTransform = z.infer<typeof recipeTransformSchema>;

export const recipeFieldSchema = z.object({
  /**
   * Candidate paths, tried in order until one yields a usable value.
   *
   * A list rather than a single path because APIs routinely offer the same
   * thing in several places — three poster sizes, any of which may be absent.
   */
  from: z.array(z.string().max(200)).min(1).max(8),
  as: recipeTransformSchema.default("text"),
  /** Compared against for `equals` / `notEquals`. */
  value: z.string().max(200).optional(),
  /** Used when every path came back empty. */
  fallback: z.union([z.string().max(5000), z.number(), z.boolean()]).optional(),
});

export type RecipeField = z.infer<typeof recipeFieldSchema>;

/** Placeholders a recipe may use in query values. */
const PLACEHOLDERS = ["{query}", "{limit}", "{id}"] as const;

const recipeRequestSchema = z.object({
  /** Absolute https endpoint. `{id}` may appear in the path for details. */
  url: z.string().url().max(2000),
  query: z.record(z.string().max(100), z.string().max(500)).default({}),
  headers: z.record(z.string().max(100), z.string().max(500)).default({}),
  /** Where the results array lives. Empty means the response IS the array. */
  itemsAt: z.string().max(200).default(""),
});

export const sourceRecipeSchema = z
  .object({
    kind: z.literal("vestra-source-recipe"),
    recipeVersion: z.literal(1),
    id: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9._-]+$/, "May contain only letters, digits, dot, dash, underscore"),
    name: z.string().min(1).max(120),
    version: z.string().min(1).max(40),
    author: z.string().max(120).optional(),
    description: z.string().max(2000).optional(),
    kinds: z.array(mediaKindSchema).min(1).max(6),
    /** Upper bound the API itself enforces. Kitsu errors above 20, for one. */
    maxLimit: z.number().int().min(1).max(100).default(20),
    search: recipeRequestSchema.extend({
      fields: z.object({
        id: recipeFieldSchema,
        title: recipeFieldSchema,
        year: recipeFieldSchema.optional(),
        poster: recipeFieldSchema.optional(),
        description: recipeFieldSchema.optional(),
        isSeries: recipeFieldSchema.optional(),
      }),
    }),
    details: recipeRequestSchema
      .extend({
        fields: z.object({
          id: recipeFieldSchema,
          title: recipeFieldSchema,
          year: recipeFieldSchema.optional(),
          poster: recipeFieldSchema.optional(),
          description: recipeFieldSchema.optional(),
          isSeries: recipeFieldSchema.optional(),
          genres: recipeFieldSchema.optional(),
          episodeCount: recipeFieldSchema.optional(),
          rating: recipeFieldSchema.optional(),
        }),
      })
      .optional(),
  })
  .superRefine((recipe, ctx) => {
    for (const [label, request] of [
      ["search", recipe.search],
      ["details", recipe.details],
    ] as const) {
      if (request === undefined) continue;

      if (!request.url.startsWith("https://")) {
        ctx.addIssue({
          code: "custom",
          path: [label, "url"],
          message: "Must be an https URL.",
        });
      }

      for (const [key, value] of Object.entries(request.query)) {
        // A placeholder we don't substitute would be sent literally, which
        // silently queries for the string "{querry}" and returns nothing.
        for (const match of value.matchAll(/\{[a-z]+\}/gi)) {
          if (!(PLACEHOLDERS as readonly string[]).includes(match[0])) {
            ctx.addIssue({
              code: "custom",
              path: [label, "query", key],
              message: `Unknown placeholder ${match[0]}. Available: ${PLACEHOLDERS.join(", ")}.`,
            });
          }
        }
      }
    }

    if (recipe.details !== undefined) {
      const usesId =
        recipe.details.url.includes("{id}") ||
        Object.values(recipe.details.query).some((value) => value.includes("{id}"));

      if (!usesId) {
        ctx.addIssue({
          code: "custom",
          path: ["details", "url"],
          message: "Never uses {id}, so it would fetch the same record for every title.",
        });
      }
    }
  });

export type SourceRecipe = z.infer<typeof sourceRecipeSchema>;

export interface RecipeParseResult {
  recipe: SourceRecipe | null;
  errors: string[];
}

export function parseSourceRecipe(input: unknown): RecipeParseResult {
  const parsed = sourceRecipeSchema.safeParse(input);

  if (parsed.success) return { recipe: parsed.data, errors: [] };

  return {
    recipe: null,
    errors: parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "recipe"}: ${issue.message}`,
    ),
  };
}

/* =============================================================================
 * Applying it
 * ========================================================================== */

function firstPresent(record: unknown, paths: readonly string[]): unknown {
  for (const path of paths) {
    const value = resolveRecipePath(record, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/** Apply one field rule to one record. Returns undefined when nothing matched. */
export function applyRecipeField(record: unknown, field: RecipeField): unknown {
  const raw = firstPresent(record, field.from);

  if (raw === undefined) return field.fallback;

  switch (field.as) {
    case "text":
      return typeof raw === "object" ? field.fallback : String(raw);

    case "number": {
      const value = Number.parseFloat(String(raw));
      return Number.isFinite(value) ? value : field.fallback;
    }

    case "year": {
      // Handles "2023-09-29", "2023", and a bare 2023.
      const value = Number.parseInt(String(raw).slice(0, 4), 10);
      return Number.isInteger(value) ? value : field.fallback;
    }

    case "httpsUrl": {
      const value = String(raw);
      // The result contract refuses plain http, so drop it here rather than
      // send it on to be rejected as a validation error the author can't see.
      return value.startsWith("https://") ? value : field.fallback;
    }

    case "boolean":
      return raw === true || raw === "true" || raw === 1 || raw === "1";

    case "equals":
      return String(raw) === (field.value ?? "");

    case "notEquals":
      return String(raw) !== (field.value ?? "");

    case "textList":
      return Array.isArray(raw)
        ? raw.filter((entry) => typeof entry === "string" || typeof entry === "number")
            .map((entry) => String(entry))
        : field.fallback;

    default:
      return field.fallback;
  }
}

type FieldMap = Record<string, RecipeField | undefined>;

/** Build one result object from a record, dropping fields that produced nothing. */
export function applyRecipeFields(record: unknown, fields: FieldMap): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [name, field] of Object.entries(fields)) {
    if (field === undefined) continue;
    const value = applyRecipeField(record, field);
    if (value !== undefined) result[name] = value;
  }

  return result;
}

/**
 * Fields the result contract will not accept a result without.
 *
 * A record that cannot supply them is dropped rather than patched. APIs
 * routinely return placeholder rows, and inventing a title for one puts
 * "Untitled" in front of the user as though it were a real thing they could
 * open. Giving a field a `fallback` is how an author opts out of this — no
 * fallback means the field is required.
 */
const REQUIRED_RESULT_FIELDS = ["id", "title"] as const;

/** Map every record, dropping the ones that cannot form a usable result. */
export function mapRecipeRecords(
  records: readonly unknown[],
  fields: FieldMap,
): Record<string, unknown>[] {
  const mapped: Record<string, unknown>[] = [];

  for (const record of records) {
    const result = applyRecipeFields(record, fields);

    const usable = REQUIRED_RESULT_FIELDS.every((name) => {
      const value = result[name];
      return value !== undefined && value !== null && value !== "";
    });

    if (usable) mapped.push(result);
  }

  return mapped;
}

/* =============================================================================
 * Requests
 * ========================================================================== */

export interface RecipeBindings {
  query?: string;
  limit?: number;
  id?: string;
}

/**
 * Build the URL for one call.
 *
 * Values are substituted through `URLSearchParams`, never by string
 * concatenation, so a query containing `&`, `#` or a second `?` is a search
 * term rather than an extra parameter. `{id}` in the path is encoded for the
 * same reason: an id is data, and an id containing `../` must not become one.
 */
export function buildRecipeUrl(
  request: { url: string; query: Record<string, string> },
  bindings: RecipeBindings,
): string {
  const substitute = (value: string): string =>
    value
      .replaceAll("{query}", bindings.query ?? "")
      .replaceAll("{limit}", String(bindings.limit ?? ""))
      .replaceAll("{id}", bindings.id ?? "");

  const url = new URL(
    request.url.replaceAll("{id}", encodeURIComponent(bindings.id ?? "")),
  );

  if (url.protocol !== "https:") {
    throw new Error("A recipe may only call https endpoints.");
  }

  for (const [key, value] of Object.entries(request.query)) {
    url.searchParams.set(key, substitute(value));
  }

  return url.toString();
}

/** Hosts a recipe will contact, for the manifest and the consent prompt. */
export function recipeHosts(recipe: SourceRecipe): string[] {
  const hosts = new Set<string>();

  for (const request of [recipe.search, recipe.details]) {
    if (request === undefined) continue;
    try {
      hosts.add(new URL(request.url.replaceAll("{id}", "x")).hostname.toLowerCase());
    } catch {
      // Unreachable for a parsed recipe: the schema already validated the URL.
    }
  }

  return [...hosts].sort();
}

/**
 * Pull the result array out of a decoded response.
 *
 * Returns an empty array rather than throwing when the path misses, because
 * "this endpoint returned a shape the recipe did not expect" is a normal
 * authoring mistake and the caller reports it as no results.
 */
export function recipeItems(payload: unknown, itemsAt: string): unknown[] {
  const located = itemsAt.length === 0 ? payload : resolveRecipePath(payload, itemsAt);
  return Array.isArray(located) ? located : [];
}
