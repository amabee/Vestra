import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import type { DiscoveryCategory } from "@vestra/extension-host";
import type { MediaItem } from "@vestra/types";
import { bridge } from "@/lib/bridge";
import { animeMessage } from "./anime-message";

const labels: Record<DiscoveryCategory, string> = {
  suggested: "Suggested",
  ongoing: "Ongoing",
  latest: "Latest",
  upcoming: "Upcoming",
  popular: "Popular",
};
export function AnimeSourceBrowse({
  provider,
  available,
  categories,
  renderCards,
}: {
  provider: string;
  available: boolean;
  categories?: readonly DiscoveryCategory[];
  renderCards: (items: MediaItem[]) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const options = categories?.length
    ? categories
    : (Object.keys(labels) as DiscoveryCategory[]);
  const requested = params.get("category") as DiscoveryCategory | null;
  const category =
    requested && options.includes(requested) ? requested : options[0]!;
  const rawPage = Number(params.get("page") ?? 1);
  const page =
    Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100 ? rawPage : 1;
  const patch = (values: Record<string, string>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) next.set(key, value);
      return next;
    });
  useEffect(() => {
    if (
      available &&
      (params.get("category") !== category ||
        params.get("page") !== String(page))
    )
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("category", category);
          next.set("page", String(page));
          return next;
        },
        { replace: true },
      );
  }, [available, category, page, params, setParams]);
  const result = useQuery({
    queryKey: ["anime-discovery", provider, category, page],
    queryFn: () => bridge.anime.browse(provider, { category, page }),
    enabled: available,
    staleTime: 120_000,
    retry: false,
  });
  if (!available)
    return (
      <section className="anime-hub-empty">
        <h2>Choose a streaming extension</h2>
        <p>
          Enable a source to browse and open anime with it. Local files are
          available from your library.
        </p>
        <Link to="/extensions">Manage extensions</Link>
      </section>
    );
  return (
    <section className="anime-hub-section" aria-label="Browse installed source">
      <div
        className="anime-discovery-categories"
        role="group"
        aria-label="Discovery category"
      >
        {options.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={category === value}
            onClick={() => patch({ category: value, page: "1" })}
          >
            {labels[value]}
          </button>
        ))}
      </div>
      <div className="anime-hub-section-title">
        <h2>{labels[category]}</h2>
        <span>Page {page}</span>
      </div>
      <p className="anime-discovery-note">
        {categories?.length
          ? "Titles from your selected extension's discovery feed."
          : "AniList catalogue discovery. Availability on your selected extension is checked when you open a title. Suggested follows catalogue trends; Latest shows recent releases."}
      </p>
      {result.isPending ? (
        <div
          className="anime-card-grid"
          role="status"
          aria-label="Loading source discovery"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="anime-tile-skeleton">
              <span />
              <i />
            </div>
          ))}
        </div>
      ) : result.error ? (
        <div className="anime-hub-empty" role="alert">
          <h3>Could not load discovery</h3>
          <p>{animeMessage(result.error)}</p>
          <button type="button" onClick={() => void result.refetch()}>
            Retry discovery
          </button>
        </div>
      ) : result.data?.items.length ? (
        renderCards(result.data.items)
      ) : (
        <div className="anime-hub-empty">
          <h3>No titles in this category</h3>
          <p>
            Try another category, return to the previous page, or search this
            source in Discover.
          </p>
        </div>
      )}
      <nav className="anime-discovery-pagination" aria-label="Discovery pages">
        <button
          type="button"
          disabled={page === 1 || result.isFetching}
          onClick={() => patch({ page: String(page - 1) })}
        >
          Previous page
        </button>
        <span aria-live="polite">Page {page}</span>
        <button
          type="button"
          disabled={!result.data?.hasMore || result.isFetching || page === 100}
          onClick={() => patch({ page: String(page + 1) })}
        >
          Next page
        </button>
      </nav>
    </section>
  );
}
