import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSearchResults, parseDetails } from "./contract";
import {
  applyRecipeField,
  buildRecipeUrl,
  mapRecipeRecords,
  parseSourceRecipe,
  recipeHosts,
  recipeItems,
  resolveRecipePath,
  type SourceRecipe,
} from "./recipe";

/**
 * The no-code path, held to the same standard as the code path.
 *
 * The payloads below are the ones `examples/kitsu.test.ts` uses, copied
 * deliberately: if a recipe cannot reproduce what the hand-written extension
 * produces from identical input, the format is not good enough to offer as an
 * alternative.
 */

const RECIPE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../examples/kitsu-recipe/recipe.json",
);

async function kitsuRecipe(): Promise<SourceRecipe> {
  const { recipe, errors } = parseSourceRecipe(
    JSON.parse(await readFile(RECIPE_PATH, "utf8")),
  );
  expect(errors).toEqual([]);
  if (recipe === null) throw new Error("unreachable");
  return recipe;
}

const SEARCH_RESPONSE = {
  data: [
    {
      id: "46474",
      attributes: {
        canonicalTitle: "Sousou no Frieren",
        startDate: "2023-09-29",
        synopsis: "The story follows the elf mage Frieren.",
        subtype: "TV",
        posterImage: {
          medium: "https://media.kitsu.app/anime/46474/poster_image/medium.jpeg",
        },
      },
    },
    {
      id: "49240",
      attributes: {
        canonicalTitle: "Sousou no Frieren 2nd Season",
        startDate: "2026-01-16",
        synopsis: "",
        subtype: "TV",
        posterImage: null,
      },
    },
    { id: "1", attributes: {} },
  ],
};

const DETAILS_RESPONSE = {
  data: {
    id: "46474",
    attributes: {
      canonicalTitle: "Sousou no Frieren",
      startDate: "2023-09-29",
      synopsis: "The story follows the elf mage Frieren.",
      subtype: "TV",
      posterImage: { medium: "https://media.kitsu.app/anime/46474/poster_image/medium.jpeg" },
      episodeCount: 28,
      averageRating: "88.8",
    },
  },
};

describe("the example recipe against recorded Kitsu payloads", () => {
  it("produces results the result contract accepts", async () => {
    const recipe = await kitsuRecipe();
    const records = recipeItems(SEARCH_RESPONSE, recipe.search.itemsAt);
    const mapped = mapRecipeRecords(records, recipe.search.fields);

    const { value, errors } = parseSearchResults(mapped);

    expect(errors).toEqual([]);
    expect(value).toEqual([
      {
        id: "46474",
        title: "Sousou no Frieren",
        year: 2023,
        poster: "https://media.kitsu.app/anime/46474/poster_image/medium.jpeg",
        description: "The story follows the elf mage Frieren.",
        isSeries: true,
      },
      {
        id: "49240",
        title: "Sousou no Frieren 2nd Season",
        year: 2026,
        poster: null,
        description: "",
        isSeries: true,
      },
    ]);
  });

  it("drops the record with no title, exactly as the coded extension does", async () => {
    const recipe = await kitsuRecipe();
    const mapped = mapRecipeRecords(
      recipeItems(SEARCH_RESPONSE, recipe.search.itemsAt),
      recipe.search.fields,
    );

    expect(mapped).toHaveLength(2);
    expect(mapped.some((item) => item["id"] === "1")).toBe(false);
  });

  it("produces details the contract accepts", async () => {
    const recipe = await kitsuRecipe();
    if (recipe.details === undefined) throw new Error("example lost its details request");

    const record = resolveRecipePath(DETAILS_RESPONSE, recipe.details.itemsAt);
    const mapped = mapRecipeRecords([record], recipe.details.fields)[0];

    const { value, errors } = parseDetails(mapped);

    expect(errors).toEqual([]);
    expect(value?.episodeCount).toBe(28);
    expect(value?.rating).toBe(88.8);
    expect(value?.title).toBe("Sousou no Frieren");
  });

  it("names the host it will contact", async () => {
    expect(recipeHosts(await kitsuRecipe())).toEqual(["kitsu.io"]);
  });
});

describe("building requests", () => {
  const request = {
    url: "https://api.example.test/search",
    query: { q: "{query}", limit: "{limit}" },
  };

  it("substitutes through URLSearchParams, so a query cannot add parameters", () => {
    const url = buildRecipeUrl(request, { query: "a&admin=1#x", limit: 5 });

    expect(new URL(url).searchParams.get("q")).toBe("a&admin=1#x");
    expect(new URL(url).searchParams.get("admin")).toBeNull();
  });

  it("encodes an id placed in the path", () => {
    const url = buildRecipeUrl(
      { url: "https://api.example.test/anime/{id}", query: {} },
      { id: "../../admin" },
    );

    expect(url).toBe("https://api.example.test/anime/..%2F..%2Fadmin");
    expect(new URL(url).pathname).not.toContain("/admin");
  });

  it("refuses a non-https endpoint even if one slips past the schema", () => {
    expect(() => buildRecipeUrl({ url: "http://api.example.test/x", query: {} }, {})).toThrow(
      /https/,
    );
  });
});

describe("reading values", () => {
  it("will not walk the prototype chain", () => {
    expect(resolveRecipePath({ a: 1 }, "__proto__")).toBeUndefined();
    expect(resolveRecipePath({ a: 1 }, "constructor.prototype")).toBeUndefined();
    expect(resolveRecipePath({ a: { b: 2 } }, "a.b")).toBe(2);
  });

  it("indexes arrays", () => {
    expect(resolveRecipePath({ a: [{ b: "x" }] }, "a.0.b")).toBe("x");
    expect(resolveRecipePath({ a: [{ b: "x" }] }, "a.nope.b")).toBeUndefined();
  });

  it("ignores inherited properties", () => {
    const parent = { secret: "no" };
    const child = Object.create(parent) as Record<string, unknown>;
    child["own"] = "yes";

    expect(resolveRecipePath(child, "own")).toBe("yes");
    expect(resolveRecipePath(child, "secret")).toBeUndefined();
  });

  it("falls through the candidate paths in order", () => {
    const field = { from: ["a", "b", "c"], as: "text" as const };
    expect(applyRecipeField({ b: "second" }, field)).toBe("second");
    expect(applyRecipeField({ a: "", b: "second" }, field)).toBe("second");
  });

  it("drops a non-https URL rather than sending one to be rejected", () => {
    const field = { from: ["u"], as: "httpsUrl" as const };
    expect(applyRecipeField({ u: "http://x.test/a.jpg" }, field)).toBeUndefined();
    expect(applyRecipeField({ u: "https://x.test/a.jpg" }, field)).toBe("https://x.test/a.jpg");
  });

  it("reads a year from an ISO date, a bare year, or a number", () => {
    const field = { from: ["d"], as: "year" as const };
    expect(applyRecipeField({ d: "2023-09-29" }, field)).toBe(2023);
    expect(applyRecipeField({ d: "2023" }, field)).toBe(2023);
    expect(applyRecipeField({ d: 2023 }, field)).toBe(2023);
    expect(applyRecipeField({ d: "soon" }, field)).toBeUndefined();
  });
});

describe("recipe validation", () => {
  function base(): Record<string, unknown> {
    return {
      kind: "vestra-source-recipe",
      recipeVersion: 1,
      id: "x",
      name: "X",
      version: "1.0.0",
      kinds: ["anime"],
      search: {
        url: "https://api.example.test/s",
        query: { q: "{query}" },
        itemsAt: "data",
        fields: { id: { from: ["id"] }, title: { from: ["t"] } },
      },
    };
  }

  it("refuses a plain http endpoint", () => {
    const recipe = base();
    (recipe["search"] as Record<string, unknown>)["url"] = "http://api.example.test/s";

    const { recipe: parsed, errors } = parseSourceRecipe(recipe);
    expect(parsed).toBeNull();
    expect(errors.join(" ")).toContain("https");
  });

  it("catches a misspelled placeholder instead of searching for it literally", () => {
    const recipe = base();
    (recipe["search"] as Record<string, unknown>)["query"] = { q: "{querry}" };

    const { errors } = parseSourceRecipe(recipe);
    expect(errors.join(" ")).toContain("Unknown placeholder {querry}");
  });

  it("refuses a details request that would fetch the same record every time", () => {
    const recipe = base();
    recipe["details"] = {
      url: "https://api.example.test/one",
      query: {},
      itemsAt: "data",
      fields: { id: { from: ["id"] }, title: { from: ["t"] } },
    };

    const { errors } = parseSourceRecipe(recipe);
    expect(errors.join(" ")).toContain("{id}");
  });

  it("requires at least one content kind, so results have somewhere to go", () => {
    const recipe = base();
    recipe["kinds"] = [];

    expect(parseSourceRecipe(recipe).recipe).toBeNull();
  });
});
