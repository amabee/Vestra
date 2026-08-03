import { tmdb } from "@vestra/api";
import type { Metadata } from "next";

import { CategoryPage } from "@/components/media/category-page";

export const metadata: Metadata = { title: "TV Shows" };
export const revalidate = 3600;

export default function TvPage() {
  return (
    <CategoryPage
      title="TV Shows"
      description="Trending series this week."
      load={() => tmdb.getTrendingTv("week")}
      unavailableHint="Add TMDB_ACCESS_TOKEN or TMDB_API_KEY to your .env.local."
    />
  );
}
