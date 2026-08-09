/**
 * Reference Vestra stream-source extension.
 *
 * A contract demo, not an integration. Every value below is invented and the
 * URLs point at `example.com`, so nothing here resolves and nothing plays.
 * That is the point: it shows the shape of the three calls without taking a
 * position on where streams should come from.
 *
 * It declares no permissions at all, which is worth noticing — a stream source
 * that never touches the network needs no grant, and this one demonstrates the
 * full contract without asking the user for anything. A real one would declare
 * `network` plus the hosts it intends to reach, and would then be held to that
 * list by the broker.
 *
 * Written as plain ES2020 with no imports, because it is evaluated inside an
 * isolate: there is no module resolver, no `require`, no `fetch`, no `process`
 * and no filesystem. The only thing reachable is the `host` object handed to
 * `activate`, carrying exactly the permissions the user granted.
 *
 * The counterpart for catalogue extensions is `examples/open-library`. The two
 * are separate on purpose: this one declares `role: "stream-source"`, which is
 * what keeps it out of catalogue search.
 */

/** Stand-in catalogue. A real source would fetch and parse this. */
const TITLES = [
  { id: "title-1", title: "Placeholder Series", episodes: 3 },
  { id: "title-2", title: "Placeholder Series II", episodes: 2 },
];

/**
 * Called once when the extension is loaded.
 *
 * @param {object} context
 * @param {object} context.host     Brokered host API. Only granted capabilities appear.
 * @param {object} context.manifest Read-only { id, name, version }.
 * @returns methods the host may call.
 */
export function activate(context) {
  const { host } = context;

  return {
    /**
     * Find candidate titles on this source.
     *
     * Positional arguments, matching every other Vestra extension:
     * `search(query, { limit })`. Note what is NOT returned — no synopsis, no
     * genres, no rating. A stream source identifies a title well enough to
     * pick the right one; the metadata comes from the catalogue provider.
     *
     * `provider` is deliberately absent: the host stamps it from the extension
     * id, so an extension cannot attribute its results to another source.
     *
     * @param {string} query
     * @param {{ limit: number }} options
     */
    async search(query, options) {
      const trimmed = String(query ?? "").trim().toLowerCase();
      if (trimmed.length === 0) return [];

      const limit = Math.min(Math.max(1, options?.limit ?? 20), 50);

      return TITLES.filter((entry) => entry.title.toLowerCase().includes(trimmed))
        .slice(0, limit)
        .map((entry) => ({
          id: entry.id,
          title: entry.title,
          // Optional. The host rejects non-https URLs, so build them explicitly.
          cover: `https://example.com/covers/${entry.id}.jpg`,
          url: `https://example.com/series/${entry.id}`,
        }));
    },

    /**
     * List episodes for a title id previously returned by `search`.
     *
     * `number` is the label the source uses, not a position in this array.
     * Real sources start at 0 for a prologue and use decimals for recaps, so
     * returning the index here would misalign the episode against a local
     * file's `SxxExx`.
     *
     * @param {string} animeId
     */
    async getEpisodes(animeId) {
      const entry = TITLES.find((candidate) => candidate.id === animeId);

      if (!entry) {
        host.log("warn", `Unknown title id: ${animeId}`);
        return [];
      }

      const episodes = [];

      for (let number = 1; number <= entry.episodes; number += 1) {
        episodes.push({
          id: `${entry.id}-e${number}`,
          animeId: entry.id,
          number,
          title: `Episode ${number}`,
          url: `https://example.com/series/${entry.id}/${number}`,
        });
      }

      return episodes;
    },

    /**
     * Resolve playable renditions for an episode id previously returned.
     *
     * Returns a LIST of servers, not one. Sources mirror each other, and the
     * player falls to the next when a server is down or geo-blocked — one
     * result would turn a bad mirror into an unavailable episode.
     *
     * `type` is normalised to what the player understands: `hls` for a
     * manifest it must follow, `mp4` for a file it can open. Whatever the
     * source calls those (`m3u8`, `application/x-mpegURL`, an empty string) is
     * converted before it is returned — see `adapt.ts`.
     *
     * @param {string} episodeId
     */
    async getStreams(episodeId) {
      if (typeof episodeId !== "string" || episodeId.length === 0) return [];

      return [
        {
          server: "Placeholder Server A",
          // Applied to every source below. Real hosts commonly gate their CDN
          // on Referer, so this is not decoration.
          headers: { Referer: "https://example.com/" },
          videoSources: [
            {
              url: `https://example.com/streams/${episodeId}/master.m3u8`,
              quality: "1080p",
              type: "hls",
              subtitles: [
                {
                  id: `${episodeId}-en`,
                  url: `https://example.com/subs/${episodeId}/en.vtt`,
                  language: "English",
                  isDefault: true,
                },
              ],
            },
          ],
        },
        {
          server: "Placeholder Server B",
          videoSources: [
            {
              url: `https://example.com/streams/${episodeId}/720.mp4`,
              quality: "720p",
              type: "mp4",
              // Per-source headers override the server's, for the case where
              // one mirror needs a different Referer than its siblings.
              headers: { Referer: "https://example.com/embed/" },
            },
          ],
        },
      ];
    },
  };
}
