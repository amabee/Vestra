import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { Search } from "lucide-react";
import type { DiscoveryCategory } from "@vestra/extension-host";
import { mediaKey } from "@vestra/types";
import type { ScreenKind } from "../../../../shared/screen";
import { bridge } from "@/lib/bridge";
import { AnimePoster } from "./anime-hub-cards";
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
  const [preferred] = useState(() => {
    try {
      return localStorage.getItem(`vestra-screen-source-${kind}`) ?? "";
    } catch {
      return "";
    }
  });
  const selected =
    params.get("source") ??
    (sources.data?.some((row) => row.id === preferred)
      ? preferred
      : sources.data?.[0]?.id) ??
    "";
  const source = sources.data?.find((row) => row.id === selected);
  const category = (params.get("category") ??
    source?.categories[0] ??
    "popular") as DiscoveryCategory;
  const rawPage = Number(params.get("page") ?? 1);
  const page =
    Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 100 ? rawPage : 1;
  const patch = (values: Record<string, string>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values))
        value ? next.set(key, value) : next.delete(key);
      return next;
    });
  useEffect(() => {
    if (!source) return;
    try {
      localStorage.setItem(`vestra-screen-source-${kind}`, source.id);
    } catch {
      /* Preference is optional. */
    }
  }, [kind, source?.id]);
  const canBrowse =
    !!source && (!!query || source.categories.includes(category));
  const results = useQuery({
    queryKey: ["screen-browse", kind, selected, query, category, page],
    queryFn: () =>
      bridge.screen.browse({ kind, source: selected, query, category, page }),
    enabled: canBrowse,
    staleTime: 120000,
  });
  return (
    <div className="anime-hub screen-workspace">
      <header className="hub-heading">
        <div>
          <p className="meta">Your sources · Your screen</p>
          <h1>{kind === "movie" ? "Movies" : "TV series"}</h1>
          <p>Find a title, choose what to watch, and press play.</p>
        </div>
        {!!sources.data?.length && (
          <label>
            Browse from
            <select
              aria-label="Movies and TV source"
              value={selected}
              onChange={(event) =>
                patch({
                  source: event.target.value,
                  category: "",
                  page: "",
                  q: "",
                })
              }
            >
              {!source && <option value={selected}>Unavailable source</option>}
              {sources.data.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <nav className="hub-nav" aria-label="Movies and TV browsing">
        <Link to={kind === "movie" ? "/films" : "/series"} aria-current="page">
          Installed sources
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
      ) : !source ? (
        <Notice
          title="This extension is unavailable"
          body="Choose an enabled source above."
        />
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
              placeholder={`Search ${source.name}…`}
              onChange={(event) => setInput(event.target.value)}
            />
            <button className="btn btn-primary" type="submit">
              <Search size={16} aria-hidden="true" />
              Search
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
          {!query && !!source.categories.length && (
            <label className="screen-category">
              Collection
              <select
                aria-label="Source collection"
                value={category}
                onChange={(event) =>
                  patch({ category: event.target.value, page: "" })
                }
              >
                {!source.categories.includes(category) && (
                  <option value={category}>Unavailable collection</option>
                )}
                {source.categories.map((name) => (
                  <option key={name} value={name}>
                    {name[0]!.toUpperCase() + name.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!canBrowse ? (
            <Notice
              title="Search this source"
              body="Enter a title above. This extension does not offer the selected collection."
            />
          ) : results.isPending ? (
            <div
              className="screen-grid"
              aria-label="Loading titles"
              aria-busy="true"
            >
              {Array.from({ length: 8 }, (_, index) => (
                <div className="screen-skeleton animate-pulse" key={index} />
              ))}
            </div>
          ) : results.error ? (
            <div role="alert">
              <Notice
                title="Could not load titles"
                body={results.error.message}
              />
              <button
                className="btn btn-ghost"
                onClick={() => void results.refetch()}
              >
                Retry
              </button>
            </div>
          ) : !results.data?.items.length ? (
            <Notice
              title="No titles found"
              body="Try another title or collection."
            />
          ) : (
            <>
              <p className="meta screen-result-count">
                {source.name} ·{" "}
                {query ? `Results for “${query}”` : `Page ${page}`}
              </p>
              <div className="screen-grid">
                {results.data.items.map((item) => (
                  <Link
                    className="screen-card"
                    key={mediaKey(item)}
                    to={`/media/${encodeURIComponent(item.source)}/${item.kind}/${encodeURIComponent(item.sourceId)}`}
                  >
                    <div className="screen-poster">
                      <AnimePoster item={item} />
                    </div>
                    <h2>{item.title}</h2>
                    <p>
                      {item.year ?? "Year unknown"} ·{" "}
                      {item.kind === "movie" ? "Movie" : "TV series"}
                    </p>
                  </Link>
                ))}
              </div>
            </>
          )}
          {!query && canBrowse && (
            <div className="screen-pagination">
              <button
                className="btn btn-ghost"
                disabled={page <= 1 || results.isFetching}
                onClick={() => patch({ page: String(page - 1) })}
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                className="btn btn-ghost"
                disabled={
                  !results.data?.hasMore || page >= 100 || results.isFetching
                }
                onClick={() => patch({ page: String(page + 1) })}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
