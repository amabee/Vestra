/**
 * Vestra SDK 1.3 Movies/TV authoring template, not a live scraper.
 * Replace these fixtures with site-specific host.fetch requests and parsing.
 * Declare network permission and exact API/CDN hosts before adding requests.
 * No DOM, Node.js imports or global fetch are available in the isolate.
 */
const titles = [
  { id: "movie-demo", kind: "movie", title: "Example Film", year: 2025 },
  { id: "tv-demo", kind: "tv", title: "Example Series", year: 2026 },
];
const entries = [
  // Retain animeId for compatibility with existing stream-source extensions.
  {
    id: "movie-demo-feature",
    animeId: "movie-demo",
    number: 1,
    title: "Example Film",
  },
  {
    id: "tv-demo-s0e1",
    animeId: "tv-demo",
    season: 0,
    number: 1,
    title: "Special",
  },
  {
    id: "tv-demo-s1e1",
    animeId: "tv-demo",
    season: 1,
    number: 1,
    title: "Pilot",
  },
  {
    id: "tv-demo-s1e2",
    animeId: "tv-demo",
    season: 1,
    number: 2,
    title: "The Journey",
  },
  {
    id: "tv-demo-s2e1",
    animeId: "tv-demo",
    season: 2,
    number: 1,
    title: "Return",
  },
];
export function activate() {
  return {
    async search(query, { kind, limit = 20 } = {}) {
      const text = String(query).trim().toLowerCase();
      return text
        ? titles
            .filter(
              (row) =>
                (!kind || row.kind === kind) &&
                row.title.toLowerCase().includes(text),
            )
            .slice(0, limit)
        : [];
    },
    async browse(category, { kind, page = 1, limit = 24 } = {}) {
      return {
        items:
          ["popular", "latest"].includes(category) && page === 1
            ? titles.filter((row) => !kind || row.kind === kind).slice(0, limit)
            : [],
        hasMore: false,
      };
    },
    async getEpisodes(titleId) {
      // Stable source IDs, not array positions. Seasons can repeat episode 1.
      // Movies expose one playable entry; TV exposes labelled seasons/episodes.
      return entries.filter((row) => row.animeId === titleId);
    },
    async getStreams(episodeId) {
      if (!entries.some((row) => row.id === episodeId)) return [];
      // Placeholder only. Supply actual direct HTTPS MP4/HLS URLs in a real source.
      // Do not label a web embed page as a video URL or invent an HD quality label.
      return [
        {
          server: "Example server",
          videoSources: [
            {
              url: `https://example.com/vestra-demo/${encodeURIComponent(episodeId)}.mp4`,
              quality: "auto",
              type: "mp4",
            },
          ],
        },
      ];
    },
  };
}
