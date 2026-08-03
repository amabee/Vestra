import type { Metadata } from "next";

import { CategoryPage } from "@/components/media/category-page";

export const metadata: Metadata = { title: "TV Shows" };
export const dynamic = "force-dynamic";

export default function TvPage() {
  return (
    <CategoryPage
      title="TV Shows"
      description="Trending series across every connected source."
      kind="tv"
      unavailableHint="Add TMDB_ACCESS_TOKEN or TMDB_API_KEY to your .env.local."
    />
  );
}
