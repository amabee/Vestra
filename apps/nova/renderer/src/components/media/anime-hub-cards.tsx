import { AnimeUnwatchedBadge } from "./completion-badges";
import { useSettings } from "@/lib/queries";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  ListPlus,
  Play,
  Radio,
} from "lucide-react";
import { mediaKey, type MediaItem, type WatchlistStatus } from "@vestra/types";
import type { AnimeCatalogueTitle } from "../../../../shared/anime-hub";
import { animeListLabels } from "./anime-hub-model";

export function animeDetailLink(item: MediaItem, provider: string) {
  return `/media/${encodeURIComponent(item.source)}/anime/${encodeURIComponent(item.sourceId)}${provider ? `?source=${encodeURIComponent(provider)}` : ""}`;
}
export function AnimePoster({
  item,
  eager = false,
}: {
  item: MediaItem;
  eager?: boolean;
}) {
  const { data: settings } = useSettings();
  const adult = item.isAdult === true;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.images.poster]);
  return item.images.poster &&
    !failed &&
    (!adult || settings?.privacy.showAdultContent === true) ? (
    <img
      style={
        adult && settings?.privacy.blurAdultContent !== false
          ? { filter: "blur(18px)" }
          : undefined
      }
      src={item.images.poster}
      alt=""
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="hub-poster-fallback">
      <Film aria-hidden="true" />
      <span>Artwork unavailable</span>
    </span>
  );
}
export function EpisodeCount({ title }: { title: AnimeCatalogueTitle }) {
  const { airedEpisodes: aired, totalEpisodes: total } = title;
  if (aired == null && total == null)
    return <span>Episodes not announced</span>;
  return (
    <span title="Broadcast count from AniList. Streaming-source availability is checked in details.">
      {aired ?? "?"} / {total ?? "?"} aired
    </span>
  );
}
export function AnimeHubCard({
  title,
  provider,
  saved,
  status,
  percent,
  onPlay,
  onSave,
  onPlaylist,
  onStatus,
  disabled,
  busy,
  working,
}: {
  title: AnimeCatalogueTitle;
  provider: string;
  saved?: boolean;
  status?: WatchlistStatus;
  percent?: number;
  onPlay?: () => void;
  onSave?: () => void;
  onPlaylist?: () => void;
  onStatus?: (status: WatchlistStatus) => void;
  disabled?: boolean;
  busy?: boolean;
  working?: boolean;
}) {
  const { item } = title;
  const { data: settings } = useSettings();
  if (item.isAdult === true && settings?.privacy.showAdultContent !== true)
    return null;
  return (
    <article className="hub-card" data-media-key={mediaKey(item)}>
      <Link
        className="hub-card-cover"
        to={animeDetailLink(item, provider)}
        aria-label={`Details for ${item.title}`}
      >
        <AnimePoster item={item} />
        {(title.releasing ?? item.status === "airing") && (
          <span
            className="hub-airing"
            title="Releasing now"
            aria-label="Releasing now"
          >
            <Radio size={16} />
          </span>
        )}
        {percent != null && (
          <progress
            className="hub-cover-progress"
            value={percent}
            max={1}
            aria-label={`Watching progress for ${item.title}`}
          />
        )}
      </Link>
      <Link className="hub-card-name" to={animeDetailLink(item, provider)}>
        {item.title}
      </Link>
      <div className="hub-card-facts">
        <span>{item.year ?? "Year unannounced"}</span>
        <AnimeUnwatchedBadge
          provider={provider}
          item={item}
          aired={
            title.airedEpisodes ??
            (item.status === "released" ? title.totalEpisodes : null)
          }
        />
        {title.format ||
        title.totalEpisodes != null ||
        title.airedEpisodes != null ? (
          <EpisodeCount title={title} />
        ) : null}
      </div>
      {onStatus && (
        <select
          aria-label={`List status for ${item.title}`}
          value={status ?? "planned"}
          disabled={working}
          onChange={(event) => onStatus(event.target.value as WatchlistStatus)}
        >
          {Object.entries(animeListLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      )}
      <div className="hub-card-actions">
        {onPlay && (
          <button
            className="hub-card-play"
            disabled={disabled || busy}
            aria-label={`${percent != null ? "Resume" : "Play"} ${item.title}`}
            onClick={onPlay}
          >
            <Play size={14} />
            {busy ? "Loading…" : percent != null ? "Resume" : "Play"}
          </button>
        )}
        {onSave && (
          <button
            aria-label={`${saved ? "Saved" : "Save"} ${item.title} to Plan to watch`}
            aria-pressed={saved}
            disabled={working || saved}
            onClick={onSave}
          >
            {saved ? <Check size={16} /> : <Bookmark size={16} />}
          </button>
        )}
        {onPlaylist && (
          <button
            aria-label={`Add ${item.title} to playlist`}
            onClick={onPlaylist}
          >
            <ListPlus size={16} />
          </button>
        )}
      </div>
    </article>
  );
}
export function AnimeCarousel({
  id,
  title,
  children,
  empty,
  loading = false,
}: {
  id: string;
  title: string;
  children: ReactNode;
  empty?: ReactNode;
  loading?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = () => {
    const el = rail.current;
    if (el)
      setEdges({
        start: el.scrollLeft <= 2,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      });
  };
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    measure();
    return () => observer.disconnect();
  }, [children, loading]);
  const move = (direction: number) =>
    rail.current?.scrollBy({
      left: direction * (rail.current.clientWidth * 0.85),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  return (
    <section className="hub-shelf" aria-labelledby={`${id}-heading`}>
      <div className="hub-section-heading">
        <h2 id={`${id}-heading`}>{title}</h2>
        {!loading && !empty && !(edges.start && edges.end) && (
          <div className="hub-carousel-controls">
            <button
              aria-label={`Previous ${title}`}
              disabled={edges.start}
              onClick={() => move(-1)}
            >
              <ChevronLeft size={18} />
            </button>
            <button
              aria-label={`Next ${title}`}
              disabled={edges.end}
              onClick={() => move(1)}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
      {loading ? (
        <div
          className="hub-carousel"
          role="status"
          aria-label={`Loading ${title}`}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="hub-card-skeleton" />
          ))}
        </div>
      ) : (
        (empty ?? (
          <div
            className="hub-carousel"
            ref={rail}
            onScroll={measure}
            tabIndex={0}
            aria-label={title}
          >
            {children}
          </div>
        ))
      )}
    </section>
  );
}
