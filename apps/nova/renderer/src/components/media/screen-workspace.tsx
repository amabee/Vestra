import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { Search } from "lucide-react";
import type { DiscoveryCategory } from "@vestra/extension-host";
import { useScreenFeed } from "./use-screen-feed";
import { ScreenTitleGrid } from "./screen-title-grid";
import type { ScreenKind } from "../../../../shared/screen";
import { bridge } from "@/lib/bridge";
import { Notice } from "@/components/layout/page";
import "./anime-hub.css";
import "./screen-workspace.css";

export function ScreenWorkspace({ kind }: { kind: ScreenKind }) {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const [input, setInput] = useState(query);
  useEffect(() => setInput(query), [query]);
  const sources = useQuery({
    queryKey: ["screen-sources", kind],
    queryFn: () => bridge.screen.sources(kind),
    refetchInterval: 5000,
  });
  const categories = [
    ...new Set(sources.data?.flatMap((row) => row.categories) ?? []),
  ];
  const category = (params.get("category") ??
    categories[0] ??
    "popular") as DiscoveryCategory;
  const patch = (values: Record<string, string>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values))
        value ? next.set(key, value) : next.delete(key);
      return next;
    });
  const eligible = (sources.data ?? []).filter(
    (row) => !!query || row.categories.includes(category),
  );
  const canBrowse = eligible.length > 0;
  const feed = useScreenFeed(kind, eligible, query, category);
  const sentinel = useRef<HTMLDivElement>(null);
  const lastAutoCount = useRef(-1);
  const autoArmed = useRef(false);
  const { items } = feed;
  useEffect(() => {
    lastAutoCount.current = -1;
    autoArmed.current = false;
  }, [feed.key]);
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !feed.hasMore || feed.loading || feed.warnings.length)
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (
          !autoArmed.current ||
          !entry?.isIntersecting ||
          lastAutoCount.current === items.length
        )
          return;
        autoArmed.current = false;
        lastAutoCount.current = items.length;
        feed.loadMore();
      },
      { root: target.closest("main"), rootMargin: "0px" },
    );
    const scrollRoot = target.closest("main") ?? window;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        autoArmed.current = true;
        observer.unobserve(target);
        observer.observe(target);
      });
    };
    scrollRoot.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      scrollRoot.removeEventListener("scroll", onScroll);
    };
  }, [feed.hasMore, feed.loading, feed.loadMore, items.length]);
  return (
    <div className="anime-hub screen-workspace">
      <header className="hub-heading">
        <div>
          <p className="meta">Your sources · Your screen</p>
          <h1>{kind === "movie" ? "Movies" : "TV series"}</h1>
          <p>Find a title, choose what to watch, and press play.</p>
        </div>
      </header>
      <nav className="hub-nav" aria-label="Movies and TV browsing">
        <Link to={kind === "movie" ? "/films" : "/series"} aria-current="page">
          Browse
        </Link>
        <Link to={`?view=catalogue`}>Catalogue</Link>
        <Link to="/extensions">Manage extensions</Link>
      </nav>
      {sources.isPending ? (
        <p role="status">Loading sources…</p>
      ) : sources.error ? (
        <div role="alert">
          <Notice
            title="Could not load extensions"
            body={sources.error.message}
          />
          <button onClick={() => void sources.refetch()}>Retry</button>
        </div>
      ) : !sources.data?.length ? (
        <div className="hub-empty">
          <h2>Bring your own {kind === "movie" ? "movie" : "TV"} source</h2>
          <p>
            Install a Vestra extension that supports{" "}
            {kind === "movie" ? "movies" : "TV series"}. Catalogue browsing and
            local files remain available.
          </p>
          <Link className="btn btn-primary" to="/extensions">
            Browse extensions
          </Link>
          <Link className="btn btn-ghost" to="?view=catalogue">
            Open catalogue
          </Link>
        </div>
      ) : (
        <>
          <form
            className="screen-search"
            onSubmit={(event) => {
              event.preventDefault();
              patch({ q: input.trim(), page: "" });
            }}
          >
            <label className="sr-only" htmlFor={`screen-search-${kind}`}>
              Search {kind === "movie" ? "movies" : "TV series"}
            </label>
            <input
              id={`screen-search-${kind}`}
              value={input}
              maxLength={500}
              placeholder="Search movies and series..."
              onChange={(event) => setInput(event.target.value)}
            />
            <button className="btn btn-primary" type="submit">
              <Search size={16} aria-hidden="true" />
              Search
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={feed.refresh}
              disabled={feed.loading}
            >
              Refresh titles
            </button>
            {!!query && (
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => patch({ q: "", page: "" })}
              >
                Clear
              </button>
            )}
          </form>
          {!query && !!categories.length && (
            <label className="screen-category">
              Collection
              <select
                aria-label="Source collection"
                value={category}
                onChange={(event) =>
                  patch({ category: event.target.value, page: "" })
                }
              >
                {!categories.includes(category) && (
                  <option value={category}>Unavailable collection</option>
                )}
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name[0]!.toUpperCase() + name.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!!feed.warnings.length && (
            <div className="screen-source-warning" role="status">
              <p>Some providers could not load. {feed.warnings.join("; ")}</p>
              <button className="btn btn-ghost btn-sm" onClick={feed.retry}>
                Retry unavailable providers
              </button>
            </div>
          )}
          {!canBrowse ? (
            <Notice
              title="Search this source"
              body="Enter a title above. Your installed extensions do not offer this collection."
            />
          ) : feed.initialPending ? (
            <div
              className="screen-grid"
              aria-label="Loading titles"
              aria-busy="true"
            >
              {Array.from({ length: 8 }, (_, index) => (
                <div className="screen-skeleton animate-pulse" key={index} />
              ))}
            </div>
          ) : feed.error && !items.length && !feed.loading ? (
            <div role="alert">
              <Notice title="Could not load titles" body={feed.error.message} />
              <button className="btn btn-ghost" onClick={() => feed.retry()}>
                Retry
              </button>
            </div>
          ) : !items.length ? (
            <Notice
              title="No titles found"
              body="Try another title or collection."
            />
          ) : (
            <>
              <p className="meta screen-result-count">
                All providers ·{" "}
                {query
                  ? `Results for “${query}”`
                  : `${items.length} titles loaded`}
              </p>
              <ScreenTitleGrid key={feed.key} items={items} />
            </>
          )}
          {canBrowse && (
            <div className="screen-pagination" ref={sentinel}>
              {feed.loading && <p role="status">Loading more titles...</p>}
              {feed.hasMore || feed.warnings.length > 0 ? (
                <button
                  className="btn btn-ghost"
                  onClick={() => feed.loadMore(true)}
                  disabled={feed.loading && !feed.hasMore}
                >
                  {feed.warnings.length ? "Retry loading more" : "Load more"}
                </button>
              ) : !feed.loading && items.length > 0 ? (
                <p role="status">
                  {feed.capped
                    ? "Browsing limit reached. Search to narrow your results."
                    : "All available titles loaded"}
                </p>
              ) : null}
            </div>
          )}
        </>
      )}
    </div>
  );
}
