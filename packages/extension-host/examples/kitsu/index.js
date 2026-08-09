/**
 * Reference provider extension.
 *
 * Where the Open Library example demonstrates the contract, this one is meant
 * to be genuinely useful: it declares `kinds: ["anime"]`, so Vestra registers
 * it as a search provider and its results appear beside AniList and TMDb.
 *
 * Kitsu was chosen because it publishes an open API that needs no key and no
 * account, so anyone can run this without signing up for anything.
 *
 * Written as plain ES2020 with no imports. This runs inside an isolate: there
 * is no module resolver, no `require`, no `fetch`, no `process`, no timers and
 * no filesystem. The only thing reachable is the `host` handed to `activate`,
 * and it carries exactly the permissions the user granted — a method for a
 * declined permission is not present at all.
 */

const API = "https://kitsu.io/api/edge";

/** Kitsu returns rating as a 0–100 string; anything else is not a rating. */
function toRating(value) {
  const score = Number.parseFloat(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
}

/** "2023-09-29" -> 2023. Kitsu leaves this null for unannounced titles. */
function toYear(startDate) {
  if (typeof startDate !== "string") return null;
  const year = Number.parseInt(startDate.slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

/** Everything except a film has episodes. */
function isSeries(subtype) {
  return subtype !== "movie";
}

/**
 * Posters come back as a set of sizes, any of which may be missing.
 *
 * The host rejects a non-https poster rather than rendering it, so a URL that
 * does not qualify is dropped here instead of being sent and refused.
 */
function toPoster(posterImage) {
  const candidate =
    posterImage?.medium ?? posterImage?.small ?? posterImage?.original ?? null;

  return typeof candidate === "string" && candidate.startsWith("https://")
    ? candidate
    : null;
}

function toItem(record) {
  const attributes = record?.attributes ?? {};

  return {
    id: String(record?.id ?? ""),
    title: String(attributes.canonicalTitle ?? "Untitled"),
    year: toYear(attributes.startDate),
    poster: toPoster(attributes.posterImage),
    description:
      typeof attributes.synopsis === "string" ? attributes.synopsis.slice(0, 5000) : "",
    isSeries: isSeries(attributes.subtype),
  };
}

export function activate(context) {
  const { host } = context;

  // Fail at activation rather than on the first search. Without network this
  // extension cannot do anything, and saying so now is actionable where an
  // empty result list later is not.
  if (typeof host.fetch !== "function") {
    throw new Error("Kitsu needs internet access to search.");
  }

  /** GET some JSON, or null. Kitsu answers with JSON:API documents. */
  async function getJson(url) {
    const response = await host.fetch({
      url,
      headers: { accept: "application/vnd.api+json" },
    });

    if (response.status !== 200) {
      host.log("warn", `Kitsu returned ${response.status}`);
      return null;
    }

    try {
      return JSON.parse(response.body);
    } catch {
      host.log("error", "Kitsu returned malformed JSON");
      return null;
    }
  }

  return {
    /**
     * @param {string} query
     * @param {{ limit?: number }} options
     */
    async search(query, options) {
      const trimmed = String(query ?? "").trim();
      if (trimmed.length === 0) return [];

      // Kitsu caps page[limit] at 20 and errors above it.
      const limit = Math.min(Math.max(1, options?.limit ?? 20), 20);

      const url =
        `${API}/anime` +
        `?filter%5Btext%5D=${encodeURIComponent(trimmed)}` +
        `&page%5Blimit%5D=${limit}` +
        "&fields%5Banime%5D=canonicalTitle,startDate,synopsis,posterImage,subtype";

      const payload = await getJson(url);
      const records = Array.isArray(payload?.data) ? payload.data : [];

      return records
        .filter((record) => record?.id != null && record?.attributes?.canonicalTitle)
        .map(toItem);
    },

    /**
     * @param {string} id An id previously returned by `search`.
     */
    async getDetails(id) {
      // Only accept ids in the shape this extension itself produces. Kitsu ids
      // are numeric, and anything else is a caller mistake or a probe.
      const key = String(id ?? "");
      if (!/^\d{1,12}$/.test(key)) return null;

      const payload = await getJson(
        `${API}/anime/${key}` +
          "?fields%5Banime%5D=canonicalTitle,startDate,synopsis,posterImage,subtype,episodeCount,averageRating",
      );

      const record = payload?.data;
      if (!record) return null;

      const attributes = record.attributes ?? {};

      // Categories are a separate resource in JSON:API. A failure here costs
      // the genres, not the whole lookup.
      let genres = [];
      const categories = await getJson(`${API}/anime/${key}/categories?page%5Blimit%5D=10`);

      if (Array.isArray(categories?.data)) {
        genres = categories.data
          .map((entry) => entry?.attributes?.title)
          .filter((title) => typeof title === "string")
          .slice(0, 30);
      }

      return {
        ...toItem(record),
        genres,
        episodeCount: Number.isInteger(attributes.episodeCount)
          ? attributes.episodeCount
          : null,
        rating: toRating(attributes.averageRating),
      };
    },
  };
}

/** Optional. Called before the isolate is torn down. */
export function deactivate() {
  // Nothing to release — this extension holds no timers or handles.
}
