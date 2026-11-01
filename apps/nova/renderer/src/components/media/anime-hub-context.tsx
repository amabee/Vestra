import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, useSearchParams } from "react-router";
import { bridge } from "@/lib/bridge";
import { keys, useLibrary } from "@/lib/queries";
import {
  preferredAnimeSource,
  rememberAnimeSource,
} from "./anime-source-preference";
import { useAnimeActions } from "./anime-actions";
import { PlaylistPicker } from "./playlist-picker";
import type { MediaItem, WatchlistStatus } from "@vestra/types";
import "./anime-hub.css";

export function useAnimeHub() {
  const [params, setParams] = useSearchParams();
  const latestParams = useRef(params);
  useEffect(() => {
    latestParams.current = params;
  }, [params]);
  const sources = useQuery({
    queryKey: ["anime-sources"],
    queryFn: bridge.anime.sources,
    refetchInterval: 5000,
  });
  const files = useLibrary();
  const hasLocal = !!files.data?.length;
  const provider =
    params.get("source") ?? preferredAnimeSource(sources.data, hasLocal);
  const patch = (values: Record<string, string>) => {
    // Router functional setters do not queue like React state setters.
    const next = new URLSearchParams(latestParams.current);
    for (const [key, value] of Object.entries(values))
      value ? next.set(key, value) : next.delete(key);
    latestParams.current = next;
    setParams(next);
  };
  useEffect(() => {
    if (!params.get("source") && provider)
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set("source", provider);
          return next;
        },
        { replace: true },
      );
    if (provider) rememberAnimeSource(provider);
  }, [provider, params, setParams]);
  return {
    params,
    patch,
    provider,
    sources,
    hasLocal,
    available:
      provider === "local"
        ? hasLocal
        : !!sources.data?.some((row) => row.id === provider),
  };
}
export function AnimeHubHeader({
  title,
  lead,
  hub,
  children,
}: {
  title: string;
  lead: string;
  hub: ReturnType<typeof useAnimeHub>;
  children?: ReactNode;
}) {
  return (
    <>
      <header className="hub-heading">
        <div>
          <h1>{title}</h1>
          <p>{lead}</p>
        </div>
        <label>
          Play from
          <select
            aria-label="Streaming extension"
            value={hub.provider}
            disabled={hub.sources.isPending}
            onChange={(event) => hub.patch({ source: event.target.value })}
          >
            {!hub.provider && <option value="">Choose a source</option>}
            {hub.provider && !hub.available && (
              <option value={hub.provider}>Source unavailable</option>
            )}
            {hub.sources.data?.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
            {hub.hasLocal && <option value="local">Local files</option>}
          </select>
        </label>
      </header>
      <nav className="hub-nav" aria-label="Anime pages">
        {[
          ["/", "Home"],
          ["/discover", "Discover"],
          ["/schedule", "Schedule"],
          ["/anime", "Search and lists"],
        ].map(([path, label]) => (
          <NavLink
            key={path}
            to={
              path +
              (hub.provider
                ? `?source=${encodeURIComponent(hub.provider)}`
                : "")
            }
            end
          >
            {label}
          </NavLink>
        ))}
      </nav>
      {children}
      {hub.sources.error && (
        <p role="alert">
          Sources could not be loaded.{" "}
          <button onClick={() => void hub.sources.refetch()}>
            Retry sources
          </button>
        </p>
      )}
    </>
  );
}
export function useAnimeHubActions(provider: string) {
  const cache = useQueryClient();
  const actions = useAnimeActions();
  const [saving, setSaving] = useState<MediaItem | null>(null);
  useEffect(() => {
    actions.cancel();
  }, [provider, actions.cancel]);
  const status = useMutation({
    mutationFn: ({
      item,
      status,
    }: {
      item: MediaItem;
      status: WatchlistStatus;
    }) => bridge.watchlist.add(item, status),
    onSuccess: () => cache.invalidateQueries({ queryKey: keys.watchlist }),
  });
  return {
    actions,
    status,
    setSaving,
    playlist: saving ? (
      <PlaylistPicker
        item={saving}
        provider={provider}
        onClose={() => setSaving(null)}
      />
    ) : null,
  };
}
