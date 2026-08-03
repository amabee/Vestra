/**
 * Reference Vestra extension.
 *
 * Demonstrates the whole contract in one file. Written as plain ES2020 with no
 * imports, because it is evaluated inside an isolate: there is no module
 * resolver, no `require`, no `fetch`, no `process` and no filesystem. The only
 * thing reachable is the `host` object handed to `activate`, and that object
 * carries exactly the permissions the user granted — a method for a permission
 * that was declined is not present at all.
 *
 * Open Library was chosen because it publishes an open API and asks nothing of
 * callers, so the example is runnable without a key or an account.
 */

/**
 * Called once when the extension is loaded.
 *
 * @param {object} context
 * @param {object} context.host    Brokered host API. Only granted capabilities appear.
 * @param {object} context.manifest Read-only { id, name, version }.
 * @returns methods the host may call.
 */
export function activate(context) {
  const { host } = context;

  // Fail loudly at activation rather than on the first search. If network was
  // declined this extension cannot do its job, and saying so now gives the
  // user something actionable instead of an empty result list later.
  if (typeof host.fetch !== "function") {
    throw new Error("Open Library Example needs internet access to search.");
  }

  return {
    /**
     * @param {string} query
     * @param {{ limit: number }} options
     */
    async search(query, options) {
      const trimmed = String(query ?? "").trim();
      if (trimmed.length === 0) return [];

      const limit = Math.min(Math.max(1, options?.limit ?? 20), 50);
      const url =
        "https://openlibrary.org/search.json" +
        `?q=${encodeURIComponent(trimmed)}&limit=${limit}&fields=key,title,first_publish_year,cover_i`;

      const response = await host.fetch({ url, headers: { accept: "application/json" } });

      if (response.status !== 200) {
        host.log("warn", `Open Library returned ${response.status}`);
        return [];
      }

      let payload;
      try {
        payload = JSON.parse(response.body);
      } catch {
        host.log("error", "Open Library returned malformed JSON");
        return [];
      }

      const docs = Array.isArray(payload?.docs) ? payload.docs : [];

      return docs
        .filter((doc) => typeof doc?.key === "string" && typeof doc?.title === "string")
        .map((doc) => ({
          id: doc.key,
          title: doc.title,
          year: Number.isInteger(doc.first_publish_year) ? doc.first_publish_year : null,
          // Covers are optional; the host rejects non-https URLs, so build it explicitly.
          poster: Number.isInteger(doc.cover_i)
            ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
            : null,
          description: "",
          isSeries: false,
        }));
    },

    /**
     * @param {string} id Identifier previously returned by `search`.
     */
    async getDetails(id) {
      const key = String(id ?? "");
      // Only accept ids in the shape this extension itself produces.
      if (!/^\/works\/OL\d+W$/.test(key)) return null;

      const response = await host.fetch({
        url: `https://openlibrary.org${key}.json`,
        headers: { accept: "application/json" },
      });

      if (response.status !== 200) return null;

      let work;
      try {
        work = JSON.parse(response.body);
      } catch {
        return null;
      }

      const description =
        typeof work?.description === "string"
          ? work.description
          : typeof work?.description?.value === "string"
            ? work.description.value
            : "";

      return {
        id: key,
        title: typeof work?.title === "string" ? work.title : "Unknown",
        year: null,
        poster: null,
        description: description.slice(0, 5000),
        isSeries: false,
        genres: Array.isArray(work?.subjects) ? work.subjects.slice(0, 30) : [],
        episodeCount: null,
        rating: null,
      };
    },
  };
}

/** Optional. Called before the isolate is torn down. */
export function deactivate() {
  // Nothing to release — this extension holds no timers or handles.
}
