import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, Radio, Search, Star } from "lucide-react";
import { mediaKey } from "@vestra/types";
import { bridge } from "@/lib/bridge";
import { useWatchlist } from "@/lib/queries";
import {
  AnimeHubHeader,
  useAnimeHub,
  useAnimeHubActions,
} from "@/components/media/anime-hub-context";
import {
  AnimeCarousel,
  AnimeHubCard,
  AnimePoster,
  EpisodeCount,
  animeDetailLink,
} from "@/components/media/anime-hub-cards";

export function DiscoverRoute() {
  const hub = useAnimeHub(),
    controls = useAnimeHubActions(hub.provider),
    watchlist = useWatchlist();
  const [input, setInput] = useState(hub.params.get("q") ?? "");
  useEffect(() => setInput(hub.params.get("q") ?? ""), [hub.params]);
  const query = {
    genre: hub.params.get("genre") ?? "",
    year: hub.params.get("year") ? Number(hub.params.get("year")) : null,
    status: hub.params.get("status") ?? "",
    format: hub.params.get("format") ?? "",
    season: hub.params.get("season") ?? "",
    search: hub.params.get("q") ?? "",
  };
  const result = useQuery({
    queryKey: ["anime-explore", query],
    queryFn: () => bridge.anime.explore(query),
    retry: false,
    staleTime: 120000,
  });
  const [featured, setFeatured] = useState(0);
  useEffect(
    () => setFeatured(0),
    [
      query.genre,
      query.year,
      query.status,
      query.format,
      query.season,
      query.search,
    ],
  );
  const highlights = (
    result.data?.sections[0]?.items.length
      ? result.data.sections[0].items
      : (result.data?.sections.flatMap((section) => section.items) ?? [])
  ).slice(0, 5);
  const hero = highlights[featured % Math.max(1, highlights.length)];
  const saved = (key: string) =>
    !!watchlist.data?.some((row) => mediaKey(row.ref) === key);
  const reset = () =>
    hub.patch({
      genre: "",
      year: "",
      status: "",
      format: "",
      season: "",
      q: "",
    });
  const thisYear = new Date().getFullYear(),
    years = Array.from(
      { length: thisYear + 6 - 1900 },
      (_, i) => thisYear + 5 - i,
    );
  return (
    <div className="anime-hub hub-discover">
      <AnimeHubHeader
        title="Discover"
        lead="Seasonal standouts, new arrivals, and the next title worth saving."
        hub={hub}
      />
      {result.isPending ? (
        <div
          className="hub-feature-skeleton"
          role="status"
          aria-label="Loading featured anime"
        />
      ) : (
        hero && (
          <section className="hub-feature" aria-label="Featured anime">
            {hero.item.images.backdrop && (
              <img
                className="hub-feature-backdrop"
                src={hero.item.images.backdrop}
                alt=""
                referrerPolicy="no-referrer"
              />
            )}
            <Link
              to={animeDetailLink(hero.item, hub.provider)}
              className="hub-feature-poster"
              aria-label={`Details for ${hero.item.title}`}
            >
              <AnimePoster item={hero.item} eager />
            </Link>
            <div className="hub-feature-copy">
              <h2>{hero.item.title}</h2>
              <p className="hub-feature-genres">
                {hero.item.genres.slice(0, 4).map((genre) => (
                  <span key={genre.id}>{genre.name}</span>
                ))}
              </p>
              <div className="hub-feature-facts">
                {hero.item.rating.score != null && (
                  <span>
                    <Star size={15} />
                    {(hero.item.rating.score / 10).toFixed(1)}
                  </span>
                )}
                {hero.releasing && (
                  <span>
                    <Radio size={16} />
                    Releasing now
                  </span>
                )}
                <EpisodeCount title={hero} />
              </div>
              {hero.item.overview && (
                <p className="hub-feature-overview">{hero.item.overview}</p>
              )}
              <div className="hub-feature-actions">
                <Link
                  className="hub-primary"
                  to={animeDetailLink(hero.item, hub.provider)}
                >
                  View details
                </Link>
                <button onClick={() => controls.setSaving(hero.item)}>
                  Add to a list
                </button>
              </div>
            </div>
            {highlights.length > 1 && (
              <div className="hub-feature-controls">
                <button
                  aria-label="Previous featured anime"
                  onClick={() =>
                    setFeatured(
                      (value) =>
                        (value + highlights.length - 1) % highlights.length,
                    )
                  }
                >
                  <ChevronLeft size={18} />
                </button>
                <span>
                  {(featured % highlights.length) + 1} / {highlights.length}
                </span>
                <button
                  aria-label="Next featured anime"
                  onClick={() =>
                    setFeatured((value) => (value + 1) % highlights.length)
                  }
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            )}
          </section>
        )
      )}
      <form
        className="hub-explore-search"
        onSubmit={(event) => {
          event.preventDefault();
          hub.patch({ q: input.trim() });
        }}
      >
        <Search size={19} aria-hidden="true" />
        <input
          aria-label="Search discovery"
          value={input}
          placeholder="Search anime"
          maxLength={200}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit">Search</button>
      </form>
      <div className="hub-explore-filters" aria-label="Anime discovery filters">
        <label>
          Genre
          <select
            aria-label="Genre"
            value={query.genre}
            onChange={(event) => hub.patch({ genre: event.target.value })}
          >
            <option value="">All genres</option>
            {query.genre && !result.data?.genres.includes(query.genre) && (
              <option value={query.genre}>{query.genre}</option>
            )}
            {result.data?.genres.map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
          </select>
        </label>
        <label>
          Release year
          <select
            aria-label="Release year"
            value={query.year ?? ""}
            onChange={(event) => hub.patch({ year: event.target.value })}
          >
            <option value="">Any year</option>
            {query.year && !years.includes(query.year) && (
              <option value={query.year}>{query.year}</option>
            )}
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label>
          Release status
          <select
            aria-label="Release status"
            value={query.status}
            onChange={(event) => hub.patch({ status: event.target.value })}
          >
            <option value="">Any status</option>
            {[
              ["RELEASING", "Releasing"],
              ["NOT_YET_RELEASED", "Coming soon"],
              ["FINISHED", "Finished"],
              ["HIATUS", "On break"],
              ["CANCELLED", "Cancelled"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Season
          <select
            aria-label="Season"
            value={query.season}
            onChange={(event) => hub.patch({ season: event.target.value })}
          >
            <option value="">All seasons</option>
            {["WINTER", "SPRING", "SUMMER", "FALL"].map((season) => (
              <option key={season} value={season}>
                {season[0] + season.slice(1).toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <label>
          Format
          <select
            aria-label="Format"
            value={query.format}
            onChange={(event) => hub.patch({ format: event.target.value })}
          >
            <option value="">Any format</option>
            {[
              ["TV", "TV series"],
              ["TV_SHORT", "Short series"],
              ["MOVIE", "Movies"],
              ["SPECIAL", "Specials"],
              ["OVA", "OVA"],
              ["ONA", "ONA"],
              ["MUSIC", "Music"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button onClick={reset}>Reset filters</button>
      </div>
      <p className="hub-explore-note">
        Episode counts reflect broadcasts, not confirmed availability on your
        streaming extension.
      </p>
      {(controls.actions.error || controls.status.error) && (
        <p role="alert" className="hub-notice">
          {(controls.actions.error || controls.status.error)?.message}
        </p>
      )}
      {result.error ? (
        <div className="hub-notice" role="alert">
          <h2>Discovery could not be loaded</h2>
          <p>{result.error.message}</p>
          <button onClick={() => void result.refetch()}>Retry discovery</button>
        </div>
      ) : result.isPending ? (
        [
          "Trending right now",
          "Top anime this season",
          "Coming soon",
          "Top anime movies",
        ].map((title, i) => (
          <AnimeCarousel key={title} id={`loading-${i}`} title={title} loading>
            {null}
          </AnimeCarousel>
        ))
      ) : !result.data?.sections.some((section) => section.items.length) ? (
        <div className="hub-empty">
          <h3>No anime match these filters</h3>
          <p>Try a different genre, year, status, or format.</p>
          <button onClick={reset}>Reset filters</button>
        </div>
      ) : (
        result.data.sections.map((section) => (
          <AnimeCarousel
            key={section.id}
            id={`explore-${section.id}`}
            title={section.title}
            empty={
              !section.items.length ? (
                <p className="hub-section-empty">
                  No titles in this section match the selected filters.
                </p>
              ) : undefined
            }
          >
            {section.items.map((title) => (
              <AnimeHubCard
                key={mediaKey(title.item)}
                title={title}
                provider={hub.provider}
                saved={saved(mediaKey(title.item))}
                onPlay={() =>
                  controls.actions.mutate({
                    item: title.item,
                    provider: hub.provider,
                  })
                }
                disabled={!hub.available}
                busy={
                  controls.actions.isPending &&
                  mediaKey(controls.actions.variables.item) ===
                    mediaKey(title.item)
                }
                onSave={() => {
                  if (!saved(mediaKey(title.item)))
                    controls.status.mutate({
                      item: title.item,
                      status: "planned",
                    });
                }}
                onPlaylist={() => controls.setSaving(title.item)}
                working={controls.status.isPending || watchlist.isPending}
              />
            ))}
          </AnimeCarousel>
        ))
      )}
      {controls.playlist}
    </div>
  );
}
