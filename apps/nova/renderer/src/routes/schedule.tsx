import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { CalendarDays, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { bridge } from "@/lib/bridge";
import { useWatchlist, useHistory, useProgress } from "@/lib/queries";
import {
  AnimeHubHeader,
  useAnimeHub,
} from "@/components/media/anime-hub-context";
import {
  animeDetailLink,
  AnimePoster,
} from "@/components/media/anime-hub-cards";
import {
  animeListLabels,
  calendarWeek,
  localDateKey,
  parseCalendarDate,
} from "@/components/media/anime-hub-model";
import { playlistKey } from "@/components/media/playlist-picker";

const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
function preferredFirstDay() {
  try {
    const value = Number(
      localStorage.getItem("vestra-calendar-first-day") ?? 1,
    );
    return Number.isInteger(value) && value >= 0 && value <= 6 ? value : 1;
  } catch {
    return 1;
  }
}
export function ScheduleRoute() {
  const hub = useAnimeHub();
  const rawFirst = Number(hub.params.get("first") ?? preferredFirstDay());
  const first =
    Number.isInteger(rawFirst) && rawFirst >= 0 && rawFirst <= 6 ? rawFirst : 1;
  const date = parseCalendarDate(hub.params.get("date"));
  const week = calendarWeek(date, first);
  const status = hub.params.get("status") ?? "all";
  const showWatched = hub.params.get("watched") === "true";
  const watchlist = useWatchlist(),
    history = useHistory(),
    progress = useProgress();
  const lists = useQuery({
    queryKey: playlistKey,
    queryFn: bridge.playlists.list,
  });
  const pending =
    watchlist.isPending ||
    history.isPending ||
    progress.isPending ||
    lists.isPending;
  const listError =
    watchlist.error || history.error || progress.error || lists.error;
  const signature = JSON.stringify([
    watchlist.data?.map((row) => [row.ref, row.status, row.updatedAt]),
    lists.data?.map((list) => [list.id, list.updatedAt]),
    history.data?.map((row) => [row.id, row.watchedAt]),
    Object.entries(progress.data ?? {}).map(([key, value]) => [
      key,
      value.updatedAt,
      value.completed,
    ]),
  ]);
  const result = useQuery({
    queryKey: [
      "anime-calendar",
      localDateKey(week.start),
      first,
      status,
      signature,
    ],
    queryFn: () =>
      bridge.anime.schedule({
        from: Math.floor(week.start.getTime() / 1000),
        until: Math.floor(week.end.getTime() / 1000),
        status,
      }),
    enabled: !pending && !listError,
    retry: false,
    staleTime: 120000,
  });
  const events = (result.data?.events ?? []).filter(
    (event) => showWatched || !event.watched,
  );
  const navigateWeek = (delta: number) => {
    const target = new Date(week.start);
    target.setDate(target.getDate() + delta * 7);
    hub.patch({ date: localDateKey(target) });
  };
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const title = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).formatRange(week.start, week.days[6]!);
  return (
    <div className="anime-hub">
      <AnimeHubHeader
        title="Schedule"
        lead="A broadcast calendar for the anime in your saved lists."
        hub={hub}
      />
      <div className="hub-calendar-toolbar">
        <div className="hub-week-controls">
          <button aria-label="Previous week" onClick={() => navigateWeek(-1)}>
            <ChevronLeft size={18} />
          </button>
          <h2>{title}</h2>
          <button aria-label="Next week" onClick={() => navigateWeek(1)}>
            <ChevronRight size={18} />
          </button>
          <button onClick={() => hub.patch({ date: localDateKey(new Date()) })}>
            This week
          </button>
        </div>
        <div className="hub-calendar-filters">
          <label>
            Week begins
            <select
              aria-label="Week begins"
              value={first}
              onChange={(event) => {
                try {
                  localStorage.setItem(
                    "vestra-calendar-first-day",
                    event.target.value,
                  );
                } catch {}
                hub.patch({ first: event.target.value });
              }}
            >
              {dayNames.map((day, index) => (
                <option key={day} value={index}>
                  {day}
                </option>
              ))}
            </select>
          </label>
          <label>
            List status
            <select
              aria-label="Schedule list status"
              value={status}
              onChange={(event) => hub.patch({ status: event.target.value })}
            >
              <option value="all">All saved statuses</option>
              {Object.entries(animeListLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="hub-switch">
            <input
              type="checkbox"
              role="switch"
              aria-label="Show watched episodes"
              checked={showWatched}
              onChange={(event) =>
                hub.patch({ watched: event.target.checked ? "true" : "" })
              }
            />
            Show watched episodes
          </label>
        </div>
      </div>
      <p className="hub-calendar-caption">
        Times shown in {timezone}. Broadcast dates can differ from source
        uploads. Episodes are hidden only when their watched status is
        confirmed.
      </p>
      {listError || result.error ? (
        <div className="hub-notice" role="alert">
          <h2>Could not load your schedule</h2>
          <p>{(listError || result.error)?.message}</p>
          <button
            onClick={() => {
              if (listError) {
                void watchlist.refetch();
                void history.refetch();
                void progress.refetch();
                void lists.refetch();
              } else void result.refetch();
            }}
          >
            Retry schedule
          </button>
        </div>
      ) : pending || result.isPending ? (
        <div
          className="hub-calendar-loading"
          role="status"
          aria-label="Loading schedule"
        >
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} />
          ))}
        </div>
      ) : (
        <>
          <div className="hub-calendar" aria-label="Anime week calendar">
            {week.days.map((day) => {
              const key = localDateKey(day),
                today = key === localDateKey(new Date()),
                rows = events.filter(
                  (event) =>
                    localDateKey(new Date(event.airingAt * 1000)) === key,
                );
              return (
                <section
                  key={key}
                  className={`hub-calendar-day ${today ? "hub-calendar-today" : ""}`}
                  aria-label={day.toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                >
                  <header>
                    <h2>
                      {day.toLocaleDateString(undefined, { weekday: "short" })}
                    </h2>
                    <time dateTime={key}>
                      {day.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </time>
                  </header>
                  {rows.map((event) => (
                    <article className="hub-calendar-event" key={event.id}>
                      <Link
                        to={animeDetailLink(event.item, hub.provider)}
                        className="hub-calendar-cover"
                        aria-label={`Details for ${event.item.title}`}
                      >
                        <AnimePoster item={event.item} />
                      </Link>
                      <time
                        dateTime={new Date(event.airingAt * 1000).toISOString()}
                      >
                        {new Date(event.airingAt * 1000).toLocaleTimeString(
                          undefined,
                          { hour: "numeric", minute: "2-digit" },
                        )}
                      </time>
                      <Link to={animeDetailLink(event.item, hub.provider)}>
                        {event.item.title}
                      </Link>
                      <p>Episode {event.episode}</p>
                      <small>{animeListLabels[event.status]}</small>
                      {event.watched && (
                        <span className="hub-watched">
                          <Check size={13} />
                          Watched
                        </span>
                      )}
                    </article>
                  ))}
                  {!rows.length && (
                    <p className="hub-calendar-none">No scheduled episodes</p>
                  )}
                </section>
              );
            })}
          </div>
          {!events.length && (
            <div className="hub-empty hub-calendar-empty">
              <CalendarDays aria-hidden="true" />
              <h3>
                {result.data?.tracked
                  ? "No matching episodes this week"
                  : "Start your anime list"}
              </h3>
              <p>
                {result.data?.tracked
                  ? "Try another week, list status, or enable Show watched episodes. Past broadcast records may be incomplete."
                  : "Save a title or create a playlist to follow its broadcast schedule."}
              </p>
              <Link to={`/discover?source=${encodeURIComponent(hub.provider)}`}>
                Discover anime
              </Link>
            </div>
          )}
          {!!result.data?.unmatched.length && (
            <details className="hub-calendar-unmatched">
              <summary>
                Titles without a confirmed catalogue match (
                {result.data.unmatched.length})
              </summary>
              <p>
                These source titles could not be matched precisely to broadcast
                metadata.
              </p>
              <ul>
                {result.data.unmatched.map((title, i) => (
                  <li key={`${title}-${i}`}>{title}</li>
                ))}
              </ul>
            </details>
          )}
          {result.data?.truncated && (
            <p role="status">
              This view reached its list or schedule limit. Narrow the list
              status or choose another week.
            </p>
          )}
        </>
      )}
    </div>
  );
}
