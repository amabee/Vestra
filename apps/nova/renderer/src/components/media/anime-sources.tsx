import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { bridge } from "@/lib/bridge";
import { usePlayer } from "@/lib/player-store";
import { StreamQuality } from "@/components/player/stream-quality";
import type { AnimeSourceTitle } from "../../../../shared/anime";

export function AnimeSources() {
  const [params] = useSearchParams();
  const sources = useQuery({
    queryKey: ["anime-sources"],
    queryFn: bridge.anime.sources,
    refetchInterval: (q) => (q.state.data?.length ? false : 2000),
  });
  const [selected, setSelected] = useState(params.get("source") ?? "");
  const id = sources.data?.some((source) => source.id === selected)
    ? selected
    : (sources.data?.[0]?.id ?? "");
  return (
    <section className="mt-7 rounded-xl border rule bg-base-200/30 p-5">
      <h2 className="font-serif text-2xl">Watch from your sources</h2>
      <p className="mb-4 mt-1 text-sm text-base-content/55">
        Search a source directly and choose its title. The catalogue below is a
        separate metadata listing.
      </p>
      {sources.error && <p role="alert">{sources.error.message}</p>}
      {sources.isPending ? (
        <p role="status">Loading anime sources…</p>
      ) : !sources.data?.length ? (
        <p>
          No anime streaming sources are enabled.{" "}
          <Link className="link" to="/sources">
            Manage sources
          </Link>
        </p>
      ) : (
        <>
          <label className="mb-3 flex items-center gap-3 text-sm">
            Streaming source
            <select
              className="select select-bordered select-sm"
              value={id}
              onChange={(e) => setSelected(e.target.value)}
            >
              {sources.data.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
          <SourceSearch key={id} source={id} />
        </>
      )}
    </section>
  );
}
function SourceSearch({ source }: { source: string }) {
  const [input, setInput] = useState("");
  const [chosen, setChosen] = useState<AnimeSourceTitle | null>(null);
  const search = useMutation({
    mutationFn: (query: string) => bridge.anime.search(source, query),
  });
  if (chosen)
    return <SourceEpisodes title={chosen} onBack={() => setChosen(null)} />;
  return (
    <>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search.mutate(input.trim());
        }}
      >
        <input
          aria-label="Search streaming source"
          className="input input-bordered min-w-0 flex-1"
          value={input}
          maxLength={500}
          placeholder="Search titles on this source"
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          className="btn btn-primary"
          disabled={!input.trim() || search.isPending}
        >
          {search.isPending ? "Searching…" : "Search source"}
        </button>
      </form>
      {search.error && (
        <p role="alert" className="pt-4 text-error">
          {search.error.message}
        </p>
      )}
      {search.data?.length === 0 && (
        <p className="pt-4">
          This source returned no titles. Try a shorter name or another source.
        </p>
      )}
      <div className="grid gap-2 pt-4 sm:grid-cols-2">
        {search.data?.map((title) => (
          <button
            key={title.handle}
            className="rounded-lg border rule px-4 py-3 text-left text-sm hover:bg-base-200"
            onClick={() => setChosen(title)}
          >
            {title.title}
          </button>
        ))}
      </div>
    </>
  );
}
function SourceEpisodes({
  title,
  onBack,
}: {
  title: AnimeSourceTitle;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState("");
  const episodes = useQuery({
    queryKey: ["source-episodes", title.handle],
    queryFn: () => bridge.anime.episodes(title.handle),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const open = usePlayer((state) => state.open);
  const play = (index: number, quality?: string) => {
    if (!episodes.data) return;
    const entry = episodes.data.queue[index]!;
    open(
      episodes.data.item,
      episodes.data.queue,
      index,
      0,
      quality ? { [entry.locator]: quality } : {},
    );
  };
  return (
    <div>
      <button className="btn btn-ghost btn-sm mb-3" onClick={onBack}>
        ← Source results
      </button>
      <h3 className="text-lg font-semibold">{title.title}</h3>
      {episodes.isPending && (
        <p role="status" className="py-5">
          Loading episodes…
        </p>
      )}
      {episodes.error && (
        <p role="alert" className="py-4 text-error">
          {episodes.error.message}{" "}
          <button
            className="btn btn-sm"
            onClick={() => void episodes.refetch()}
          >
            Retry
          </button>
        </p>
      )}
      {episodes.data?.queue.length === 0 && (
        <p className="py-4">
          This title has no episodes on the selected source.
        </p>
      )}
      {!!episodes.data?.queue.length && (
        <>
          <label className="my-3 flex items-center gap-3 text-sm">
            Find episode
            <input
              className="input input-bordered input-sm"
              placeholder="Number or title"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <div className="max-h-96 overflow-auto">
            {episodes.data.queue
              .map((episode, index) => ({ episode, index }))
              .filter(({ episode }) =>
                `${episode.label} ${episode.episode ?? ""}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .map(({ episode, index }) => (
                <div
                  key={episode.locator}
                  className="flex items-center gap-3 border-b rule py-3"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {episode.label}
                  </span>
                  <StreamQuality
                    locator={episode.locator}
                    busy={false}
                    onSelect={(quality) => play(index, quality)}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => play(index)}
                  >
                    Play
                  </button>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
