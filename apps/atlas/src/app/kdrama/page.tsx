import { tmdb } from "@vestra/api";
import type { Metadata } from "next";

import { CategoryPage } from "@/components/media/category-page";

export const metadata: Metadata = { title: "K-Drama" };
export const revalidate = 3600;

export default function KdramaPage() {
  return (
    <CategoryPage
      title="K-Drama"
      description="Popular Korean series, composed from TMDb's Korean-origin catalogue."
      load={() => tmdb.getTrendingKdramas()}
      unavailableHint="Add TMDB_ACCESS_TOKEN or TMDB_API_KEY to your .env.local."
    />
  );
}
