// Contract demonstration only. Replace placeholder data with your source's API.
// Use host.fetch for metadata; declare every API/image host in the manifest.
// Image bytes are downloaded by the host, never sent through guest JavaScript.
export function activate({ host }) {
  return {
    async search(query, { limit = 100 } = {}) {
      if (!"example manga".includes(query.toLowerCase())) return [];
      return [
        {
          id: "example-book",
          title: "Example Manga",
          cover: { url: "https://images.example.org/cover.png" },
        },
      ].slice(0, limit);
    },
    async getChapters(bookId) {
      if (bookId !== "example-book") return [];
      return [
        {
          id: "example-chapter",
          number: "1",
          title: "Chapter One",
          index: 0,
          language: "en",
        },
      ];
    },
    async getPages(chapterId) {
      if (chapterId !== "example-chapter") return [];
      return [0, 1].map((index) => ({
        url: `https://images.example.org/page-${index + 1}.png`,
        index,
      }));
    },
  };
}
