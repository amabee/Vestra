import { anilist } from "@vestra/api";
import type { Metadata } from "next";

import { CategoryPage } from "@/components/media/category-page";

export const metadata: Metadata = { title: "Anime" };
export const revalidate = 3600;

export default function AnimePage() {
  return (
    <CategoryPage
      title="Anime"
      description="Trending right now on AniList."
      load={() => anilist.getTrendingAnime(1, 30)}
      unavailableHint="AniList needs no API key — check your network connection."
    />
  );
}
