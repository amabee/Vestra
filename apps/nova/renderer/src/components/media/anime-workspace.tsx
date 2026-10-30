import { animeMessage } from "./anime-message";
import {
  preferredAnimeSource,
  rememberAnimeSource,
} from "./anime-source-preference";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mediaItemSchema, mediaKey, type MediaItem } from "@vestra/types";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  Film,
  ListPlus,
  Play,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { bridge } from "@/lib/bridge";
import {
  keys,
  useProgress,
  useTrending,
  useWatchlist,
  useHistory,
  useLibrary,
} from "@/lib/queries";
import { useAnimeActions } from "./anime-actions";
import { PlaylistPicker, playlistKey } from "./playlist-picker";
import type {
  AnimePlaylist,
  PlaylistCommand,
} from "../../../../shared/playlists";
import "./anime-workspace.css";

export function AnimeWorkspace() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const view = params.get("view") ?? "discover";
  const [input, setInput] = useState(query);
  const [saving, setSaving] = useState<{
    item: MediaItem;
    provider: string;
  } | null>(null);
  const sources = useQuery({
    queryKey: ["anime-sources"],
    queryFn: bridge.anime.sources,
    refetchInterval: 5000,
  });
  const localFiles = useLibrary();
  const provider =
    params.get("source") ??
    preferredAnimeSource(sources.data, !!localFiles.data?.length);
  const hasLocal = !!localFiles.data?.length;
  const available =
    (provider === "local" && hasLocal) ||
    sources.data?.some((row) => row.id === provider);
  const patch = (values: Record<string, string>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
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
  }, [provider, params, setParams]);
  useEffect(() => {
    if (available) rememberAnimeSource(provider);
  }, [provider, available]);
  useEffect(() => setInput(query), [query]);
  const actions = useAnimeActions();
  useEffect(() => {
    if (actions.isPending && actions.variables?.provider !== provider)
      actions.cancel();
  }, [
    provider,
    actions.isPending,
    actions.variables?.provider,
    actions.cancel,
  ]);
  const trending = useTrending("anime");
  const search = useQuery({
    queryKey: ["anime-catalogue-search", query],
    queryFn: () => bridge.media.search(query, ["anime"]),
    enabled: !!query,
    retry: false,
  });
  const watchlist = useWatchlist();
  const progress = useProgress();
  const history = useHistory();
  const lists = useQuery({
    queryKey: playlistKey,
    queryFn: bridge.playlists.list,
  });
  const cache = useQueryClient();
  const later = useMutation({
    mutationFn: async (item: MediaItem) => {
      if (watchlist.data?.some((row) => mediaKey(row.ref) === mediaKey(item)))
        await bridge.watchlist.remove(item);
      else await bridge.watchlist.add(item, "planned");
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: keys.watchlist }),
  });
  const changeList = useMutation({
    mutationFn: bridge.playlists.mutate,
    onSuccess: (rows) => cache.setQueryData(playlistKey, rows),
  });
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const chosen = lists.data?.find((list) => list.id === params.get("list"));
  const savedAnime = (watchlist.data ?? [])
    .filter((row) => row.ref.kind === "anime")
    .map((row) => row.snapshot);
  const items = query
    ? (search.data?.groups.flatMap((group) => group.items) ?? [])
    : (trending.data?.flatMap((group) => group.items) ?? []);
  const unique = [
    ...new Map(items.map((item) => [mediaKey(item), item])).values(),
  ].filter((item) => item.kind === "anime");
  const hasProgress = (item: MediaItem) =>
    Object.entries(progress.data ?? {}).some(
      ([key, value]) =>
        key.startsWith(`${mediaKey(item)}#`) &&
        !value.completed &&
        value.percent >= 0.01,
    );
  const cards = (rows: MediaItem[]) => (
    <div className="anime-card-grid">
      {rows.map((item) => {
        const playbackProvider = provider;
        const saved = !!watchlist.data?.some(
          (row) => mediaKey(row.ref) === mediaKey(item),
        );
        return (
          <AnimeTile
            key={mediaKey(item)}
            item={item}
            provider={playbackProvider}
            resume={hasProgress(item)}
            saved={saved}
            savingLater={later.isPending || watchlist.isPending}
            disabled={
              !(playbackProvider === "local" && hasLocal) &&
              !sources.data?.some((source) => source.id === playbackProvider)
            }
            busy={
              actions.isPending &&
              mediaKey(actions.variables.item) === mediaKey(item)
            }
            onPlay={() => {
              if (playbackProvider !== provider)
                patch({ source: playbackProvider });
              actions.mutate({ item, provider: playbackProvider });
            }}
            onLater={() => later.mutate(item)}
            onSave={() => setSaving({ item, provider: playbackProvider })}
          />
        );
      })}
    </div>
  );
  return (
    <div className="anime-workspace">
      <header className="anime-hub-header">
        <div>
          <h1>Anime</h1>
          <p>Find your next episode. Keep the good ones close.</p>
        </div>
        <label className="anime-hub-source">
          Play from
          <select
            aria-label="Streaming extension"
            value={provider}
            disabled={sources.isPending || (!sources.data?.length && !hasLocal)}
            onChange={(event) => patch({ source: event.target.value })}
          >
            {!provider && <option value="">Choose a source</option>}
            {provider && !available && (
              <option value={provider} disabled>
                Source unavailable
              </option>
            )}
            {sources.data?.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name}
              </option>
            ))}
            {hasLocal && <option value="local">Local files</option>}
          </select>
        </label>
      </header>
      <form
        className="anime-hub-search"
        onSubmit={(event) => {
          event.preventDefault();
          patch({ q: input.trim(), view: "discover", list: "" });
        }}
      >
        <Search size={22} aria-hidden />
        <input
          aria-label="Search anime"
          placeholder="Search anime by title"
          value={input}
          maxLength={200}
          onChange={(event) => setInput(event.target.value)}
        />
        {input && (
          <button
            type="button"
            aria-label="Clear anime search"
            onClick={() => {
              setInput("");
              patch({ q: "" });
            }}
          >
            <X size={18} />
          </button>
        )}
        <button
          type="submit"
          className="anime-primary"
          disabled={!input.trim()}
        >
          Search
        </button>
      </form>
      <nav className="anime-hub-tabs" aria-label="Anime library">
        <button
          aria-current={view === "discover" ? "page" : undefined}
          onClick={() => patch({ view: "discover", list: "" })}
        >
          Discover
        </button>
        <button
          aria-current={view === "later" ? "page" : undefined}
          onClick={() => patch({ view: "later", list: "", q: "" })}
        >
          Watch later <span>{savedAnime.length}</span>
        </button>
        <button
          aria-current={view === "playlists" ? "page" : undefined}
          onClick={() => patch({ view: "playlists", q: "" })}
        >
          Playlists <span>{lists.data?.length ?? 0}</span>
        </button>
      </nav>
      {actions.isPending && (
        <div className="anime-hub-feedback" role="status">
          <span>Finding episodes for {actions.variables.item.title}…</span>
          <button onClick={actions.cancel}>Cancel</button>
        </div>
      )}
      {(actions.error || later.error || changeList.error) && (
        <div className="anime-hub-feedback" role="alert">
          {animeMessage(actions.error ?? later.error ?? changeList.error)}
          {actions.error && actions.variables && (
            <button
              onClick={() =>
                actions.mutate({ ...actions.variables!, refresh: true })
              }
            >
              Retry playback
            </button>
          )}
        </div>
      )}
      {(sources.error || (!sources.isPending && !available)) && (
        <div className="anime-hub-feedback" role="status">
          <span>
            {sources.error
              ? "Sources could not be loaded."
              : "Enable an anime source to play. You can still browse and save to Watch later."}
          </span>
          <Link to="/extensions">Manage extensions</Link>
          {sources.error && (
            <button onClick={() => void sources.refetch()}>
              Retry sources
            </button>
          )}
        </div>
      )}
      {view === "discover" && (
        <>
          {!query &&
            history.data?.some(
              (row) =>
                row.snapshot.kind === "anime" && hasProgress(row.snapshot),
            ) && (
              <section className="anime-hub-section">
                <div className="anime-hub-section-title">
                  <h2>Pick up where you left off</h2>
                </div>
                {cards(
                  [
                    ...new Map(
                      history.data
                        .filter(
                          (row) =>
                            row.snapshot.kind === "anime" &&
                            hasProgress(row.snapshot),
                        )
                        .map((row) => [mediaKey(row.snapshot), row.snapshot]),
                    ).values(),
                  ].slice(0, 6),
                )}
              </section>
            )}
          <section className="anime-hub-section">
            <div className="anime-hub-section-title">
              <h2>
                {query ? `Results for “${query}”` : "Discover something good"}
              </h2>
              {query && <span>{unique.length} titles</span>}
            </div>
            {(query ? search.isPending : trending.isPending) ? (
              <AnimeGridSkeleton />
            ) : (query ? search.error : trending.error) ? (
              <div className="anime-hub-empty" role="alert">
                <h3>Could not load anime</h3>
                <p>{animeMessage(query ? search.error : trending.error)}</p>
                <button
                  onClick={() =>
                    void (query ? search.refetch() : trending.refetch())
                  }
                >
                  Retry
                </button>
              </div>
            ) : unique.length ? (
              cards(unique)
            ) : (
              <div className="anime-hub-empty">
                <h3>
                  {query ? "No catalogue matches" : "No titles to show yet"}
                </h3>
                <p>
                  {query
                    ? "Try another spelling, or check the source matches below."
                    : "Your sources may be temporarily unavailable."}
                </p>
              </div>
            )}
            {query &&
              search.data?.groups
                .filter((group) => group.error)
                .map((group) => (
                  <p key={group.source} role="status">
                    {group.label}: {group.error}
                  </p>
                ))}
          </section>
          {query && available && provider !== "local" && (
            <SourceMatches
              key={`${provider}:${query}`}
              provider={provider}
              query={query}
              expanded={!unique.length}
              onPlay={(item, resolve) =>
                actions.mutate({ item, provider, resolve })
              }
              onSave={(item) => setSaving({ item, provider })}
            />
          )}
        </>
      )}
      {view === "later" && (
        <section className="anime-hub-section">
          <div className="anime-hub-section-title">
            <h2>Your next watches</h2>
            <p>Play now, or organize into a playlist.</p>
          </div>
          {watchlist.isPending ? (
            <AnimeGridSkeleton />
          ) : watchlist.error ? (
            <div role="alert">
              {animeMessage(watchlist.error)}
              <button onClick={() => void watchlist.refetch()}>
                Retry Watch later
              </button>
            </div>
          ) : savedAnime.length ? (
            cards(savedAnime)
          ) : (
            <div className="anime-hub-empty">
              <Bookmark size={30} />
              <h3>A little room for later</h3>
              <p>
                Save titles from search or discovery. They will be here when you
                are ready.
              </p>
              <button onClick={() => patch({ view: "discover" })}>
                Discover anime
              </button>
            </div>
          )}
        </section>
      )}
      {view === "playlists" && (
        <section className="anime-hub-section">
          <div className="anime-hub-section-title">
            <h2>{chosen ? chosen.name : "Your playlists"}</h2>
            <button
              className="anime-subtle-button"
              onClick={() => setCreating(!creating)}
            >
              <ListPlus size={17} />
              New playlist
            </button>
          </div>
          {creating && (
            <form
              className="anime-list-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (newName.trim())
                  changeList.mutate(
                    { action: "create", name: newName.trim() },
                    {
                      onSuccess: (rows) => {
                        setNewName("");
                        setCreating(false);
                        patch({ list: rows.at(-1)!.id });
                      },
                    },
                  );
              }}
            >
              <input
                autoFocus
                aria-label="New playlist name"
                placeholder="Name your playlist"
                maxLength={80}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
              />
              <button
                className="anime-primary"
                disabled={!newName.trim() || changeList.isPending}
              >
                Create playlist
              </button>
            </form>
          )}
          {lists.isPending ? (
            <p role="status">Loading playlists…</p>
          ) : lists.error ? (
            <div role="alert">
              {animeMessage(lists.error)}
              <button onClick={() => void lists.refetch()}>
                Retry playlists
              </button>
            </div>
          ) : chosen ? (
            <PlaylistContents
              list={chosen}
              busy={changeList.isPending}
              mutate={(command) => changeList.mutate(command)}
              onBack={() => patch({ list: "" })}
              provider={provider}
              sourceName={(id) =>
                sources.data?.find((source) => source.id === id)?.name ??
                (id === "local" ? "Local files" : "Unavailable source")
              }
              onPlay={(entry) => actions.mutate({ item: entry.item, provider })}
            />
          ) : lists.data?.length ? (
            <div className="anime-playlist-grid">
              {lists.data.map((list) => (
                <button
                  key={list.id}
                  className="anime-playlist-tile"
                  onClick={() => patch({ list: list.id })}
                >
                  <span className="anime-playlist-covers">
                    {list.items.length ? (
                      list.items
                        .slice(0, 3)
                        .map((entry) => (
                          <Poster
                            key={mediaKey(entry.item)}
                            item={entry.item}
                          />
                        ))
                    ) : (
                      <ListPlus size={32} />
                    )}
                  </span>
                  <strong>{list.name}</strong>
                  <span>
                    {list.items.length}{" "}
                    {list.items.length === 1 ? "title" : "titles"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="anime-hub-empty">
              <ListPlus size={30} />
              <h3>Make it your collection</h3>
              <p>Create a playlist here, or save a title from discovery.</p>
              <button onClick={() => setCreating(true)}>
                Create your first playlist
              </button>
            </div>
          )}
        </section>
      )}
      {saving && (
        <PlaylistPicker
          item={saving.item}
          provider={saving.provider}
          onClose={() => setSaving(null)}
        />
      )}
    </div>
  );
}

function Poster({ item }: { item: MediaItem }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.images.poster]);
  return item.images.poster && !failed ? (
    <img
      src={item.images.poster}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="anime-poster-placeholder">
      <Film size={28} />
    </span>
  );
}
function AnimeTile({
  item,
  provider,
  resume,
  saved,
  savingLater,
  busy,
  disabled,
  onPlay,
  onLater,
  onSave,
}: {
  item: MediaItem;
  provider: string;
  resume: boolean;
  saved: boolean;
  savingLater: boolean;
  busy: boolean;
  disabled: boolean;
  onPlay: () => void;
  onLater: () => void;
  onSave: () => void;
}) {
  const href = `/media/${item.source}/${item.kind}/${encodeURIComponent(item.sourceId)}?${new URLSearchParams({ source: provider })}`;
  return (
    <article className="anime-title-tile">
      <Link
        className="anime-tile-art"
        to={href}
        data-anime-details
        aria-label={`View ${item.title}`}
      >
        <Poster item={item} />
      </Link>
      <Link to={href} className="anime-tile-title">
        {item.title}
      </Link>
      <div className="anime-tile-meta">
        {item.year ?? "Anime"}
        {resume && <span>In progress</span>}
      </div>
      <div className="anime-tile-actions">
        <button
          type="button"
          className="anime-tile-play"
          disabled={disabled || busy}
          aria-label={`${resume ? "Resume" : "Play"} ${item.title}`}
          onClick={onPlay}
        >
          <Play size={14} />
          {busy ? "Loading…" : resume ? "Resume" : "Play"}
        </button>
        <button
          type="button"
          aria-label={`${saved ? "Remove" : "Save"} ${item.title} ${saved ? "from" : "to"} Watch later`}
          aria-pressed={saved}
          disabled={savingLater}
          onClick={onLater}
        >
          {saved ? <Check size={16} /> : <Bookmark size={16} />}
        </button>
        <button
          type="button"
          aria-label={`Add ${item.title} to playlist`}
          onClick={onSave}
        >
          <ListPlus size={17} />
        </button>
      </div>
    </article>
  );
}
function AnimeGridSkeleton() {
  return (
    <div className="anime-card-grid" role="status" aria-label="Loading anime">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="anime-tile-skeleton">
          <span />
          <i />
        </div>
      ))}
    </div>
  );
}

function SourceMatches({
  provider,
  query,
  expanded,
  onPlay,
  onSave,
}: {
  provider: string;
  query: string;
  expanded: boolean;
  onPlay: (
    item: MediaItem,
    resolve: () => Promise<
      import("../../../../shared/anime").AnimeSourceEpisodes
    >,
  ) => void;
  onSave: (item: MediaItem) => void;
}) {
  const results = useQuery({
    queryKey: ["anime-provider-search", provider, query],
    queryFn: () => bridge.anime.search(provider, query),
    retry: false,
  });
  const cache = useQueryClient();
  const save = useMutation({
    mutationFn: (handle: string) => bridge.anime.title(handle),
    onSuccess: (item) => onSave(item),
  });
  return (
    <details className="anime-source-matches" open={expanded}>
      <summary>
        Source matches{" "}
        <span>Use these when catalogue matching misses a title.</span>
      </summary>
      {results.isPending ? (
        <p role="status">Searching your selected source…</p>
      ) : results.error ? (
        <p role="alert">
          {animeMessage(results.error)}
          <button onClick={() => void results.refetch()}>
            Retry source search
          </button>
        </p>
      ) : !results.data?.length ? (
        <p>No source matches. Try a shorter title or choose another source.</p>
      ) : (
        <ul>
          {results.data.map((row) => {
            const item = mediaItemSchema.parse({
              source: provider,
              kind: "anime",
              sourceId: row.handle,
              title: row.title,
              images: {},
              rating: {},
              isSeries: true,
            });
            return (
              <li key={row.handle}>
                <strong>{row.title}</strong>
                <button
                  className="anime-subtle-button"
                  onClick={() =>
                    onPlay(item, () =>
                      cache.fetchQuery({
                        queryKey: ["source-episodes", row.handle],
                        queryFn: () => bridge.anime.episodes(row.handle),
                        staleTime: 30000,
                      }),
                    )
                  }
                >
                  <Play size={15} />
                  Play
                </button>
                <button
                  aria-label={`Add ${row.title} to playlist`}
                  disabled={save.isPending}
                  onClick={() => save.mutate(row.handle)}
                >
                  <ListPlus size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {save.isPending && <p role="status">Preparing title…</p>}
      {save.error && <p role="alert">{animeMessage(save.error)}</p>}
    </details>
  );
}

function PlaylistContents({
  list,
  busy,
  mutate,
  onBack,
  onPlay,
  provider,
  sourceName,
}: {
  list: AnimePlaylist;
  provider: string;
  sourceName: (id: string) => string;
  busy: boolean;
  mutate: (command: PlaylistCommand) => void;
  onBack: () => void;
  onPlay: (entry: AnimePlaylist["items"][number]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <div className="anime-list-toolbar">
        <button onClick={onBack}>All playlists</button>
        <button
          onClick={() => {
            setName(list.name);
            setEditing(!editing);
          }}
        >
          Rename
        </button>
        <button onClick={() => setConfirm(!confirm)}>Delete playlist</button>
      </div>
      {editing && (
        <form
          className="anime-list-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim())
              mutate({ action: "rename", id: list.id, name: name.trim() });
            setEditing(false);
          }}
        >
          <input
            aria-label="Playlist name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button disabled={!name.trim() || busy}>Save name</button>
        </form>
      )}
      {confirm && (
        <div className="anime-hub-feedback">
          <span>
            Delete “{list.name}”? Saved titles in Watch later will remain.
          </span>
          <button
            disabled={busy}
            onClick={() => {
              mutate({ action: "delete", id: list.id });
              onBack();
            }}
          >
            Delete
          </button>
          <button onClick={() => setConfirm(false)}>Cancel</button>
        </div>
      )}
      {!list.items.length ? (
        <div className="anime-hub-empty">
          <h3>Ready for your next find</h3>
          <p>Add titles using the playlist button in search or discovery.</p>
        </div>
      ) : (
        <ol className="anime-saved-rows">
          {list.items.map((entry, index) => (
            <li key={mediaKey(entry.item)}>
              <span>{index + 1}</span>
              <div className="anime-saved-poster">
                <Poster item={entry.item} />
              </div>
              <div className="anime-saved-title">
                <Link
                  to={`/media/${entry.item.source}/${entry.item.kind}/${encodeURIComponent(entry.item.sourceId)}?${new URLSearchParams({ source: provider })}`}
                >
                  {entry.item.title}
                </Link>
                {entry.provider && entry.provider !== provider && (
                  <small>Saved from {sourceName(entry.provider)}</small>
                )}
              </div>
              <div className="anime-saved-controls">
                <button
                  className="anime-tile-play"
                  onClick={() => onPlay(entry)}
                >
                  <Play size={15} />
                  Play
                </button>
                <button
                  aria-label={`Move ${entry.item.title} up`}
                  disabled={busy || index === 0}
                  onClick={() =>
                    mutate({
                      action: "move",
                      id: list.id,
                      key: mediaKey(entry.item),
                      to: index - 1,
                    })
                  }
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  aria-label={`Move ${entry.item.title} down`}
                  disabled={busy || index === list.items.length - 1}
                  onClick={() =>
                    mutate({
                      action: "move",
                      id: list.id,
                      key: mediaKey(entry.item),
                      to: index + 1,
                    })
                  }
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  aria-label={`Remove ${entry.item.title} from playlist`}
                  disabled={busy}
                  onClick={() =>
                    mutate({
                      action: "remove",
                      id: list.id,
                      key: mediaKey(entry.item),
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
