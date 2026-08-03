import type { Metadata } from "next";

import { CategoryPage } from "@/components/media/category-page";

export const metadata: Metadata = { title: "Anime" };
export const dynamic = "force-dynamic";

export default function AnimePage() {
  return (
    <CategoryPage
      title="Anime"
      description="Trending across every connected anime source."
      kind="anime"
      unavailableHint="AniList needs no API key — check your network connection."
    />
  );
}
