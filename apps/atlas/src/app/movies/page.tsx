import { tmdb } from "@vestra/api";
import type { Metadata } from "next";

import { CategoryPage } from "@/components/media/category-page";

export const metadata: Metadata = { title: "Movies" };
export const revalidate = 3600;

export default function MoviesPage() {
  return (
    <CategoryPage
      title="Movies"
      description="Trending films this week."
      load={() => tmdb.getTrendingMovies("week")}
      unavailableHint="Add TMDB_ACCESS_TOKEN or TMDB_API_KEY to your .env.local."
    />
  );
}
