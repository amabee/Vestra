import type { Metadata } from "next";

import { CategoryPage } from "@/components/media/category-page";

export const metadata: Metadata = { title: "K-Drama" };
export const dynamic = "force-dynamic";

export default function KdramaPage() {
  return (
    <CategoryPage
      title="K-Drama"
      description="Popular Korean series, composed from TMDb's Korean-origin catalogue."
      kind="kdrama"
      unavailableHint="Add TMDB_ACCESS_TOKEN or TMDB_API_KEY to your .env.local."
    />
  );
}
