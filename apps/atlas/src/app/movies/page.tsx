import type { Metadata } from "next";

import { CategoryPage } from "@/components/media/category-page";

export const metadata: Metadata = { title: "Movies" };
export const dynamic = "force-dynamic";

export default function MoviesPage() {
  return (
    <CategoryPage
      title="Movies"
      description="Trending films across every connected source."
      kind="movie"
      unavailableHint="Add TMDB_ACCESS_TOKEN or TMDB_API_KEY to your .env.local."
    />
  );
}
