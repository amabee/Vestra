import {
  SettingsSearchContext,
  useSettingMatch,
} from "@/components/settings/search";
import {
  ApplicationPreferences,
  AppearancePreferences,
  LibraryPreferences,
} from "@/components/settings/preferences";
import "./settings.css";
import {
  Activity,
  Download,
  FolderOpen,
  Palette,
  Play,
  Plug,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ACCENT_PRESETS, DEFAULT_SETTINGS, type Settings } from "@vestra/types";
import type { ReactNode } from "react";
import type { SettingsPatch } from "@/lib/bridge";
import {
  SourceHealthPanel,
  PlaybackDiagnosticsPanel,
} from "@/components/settings/source-health";
import { TorrentConnection } from "@/components/settings/torrent-connection";
import { AppUpdatesPanel } from "@/components/updates/app-updates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Loader2, RefreshCw, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";

import { Notice, Page, SectionRule } from "@/components/layout/page";
import { bridge, type ScanSummary } from "@/lib/bridge";
import { keys, useDiagnostics, useSettings } from "@/lib/queries";

const SECTIONS = [
  {
    id: "interface",
    label: "Interface & Appearance",
    icon: Palette,
    description: "Theme, color and navigation",
    keywords:
      "appearance dark light motion text accent sidebar glass background banner color sorting alphabetical continue watching anime manga navigation preloading transparency navbar unpinned menu blur genre episode filename summary carousel",
  },
  {
    id: "app",
    label: "Application",
    icon: SlidersHorizontal,
    description: "Startup and workspace",
    keywords:
      "start home status version storage watch history progress default episode source spoilers adult scores extension secure anilist account backup trailers count",
  },
  {
    id: "playback",
    label: "Playback",
    icon: Play,
    description: "Player and episode behavior",
    keywords: "video opening ending skip autoplay hardware subtitles audio",
  },
  {
    id: "torrents",
    label: "Torrents",
    icon: Download,
    description: "qBittorrent connection",
    keywords: "downloads magnet client category polling",
  },
  {
    id: "library",
    label: "Library & Scanning",
    icon: FolderOpen,
    description: "Folders and scanning",
    keywords:
      "media files scan local match directory directories automatic refresh startup advanced json configuration import export",
  },
  {
    id: "connections",
    label: "Connections",
    icon: Plug,
    description: "Catalogue credentials",
    keywords: "tmdb api token movies series",
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    icon: Activity,
    description: "Source health and playback",
    keywords: "extension health error logs copy report",
  },
  {
    id: "updates",
    label: "Updates",
    icon: RefreshCw,
    description: "App version and releases",
    keywords: "download install release version",
  },
] as const;
type SettingsSection = (typeof SECTIONS)[number]["id"];
export function SettingsRoute() {
  const { data: settings, error, isPending } = useSettings();
  const { data: diagnostics } = useDiagnostics();
  const cache = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selected = (
    location.hash === "#app-updates"
      ? "updates"
      : (params.get("section") ?? "interface")
  ) as SettingsSection;
  const active =
    SECTIONS.find((section) => section.id === selected) ?? SECTIONS[0];
  const [search, setSearch] = useState("");
  const save = useMutation({
    mutationFn: bridge.settings.patch,
    onSuccess: (value) => {
      cache.setQueryData(keys.settings, value);
    },
  });
  const showing = (id: SettingsSection) =>
    search.trim() ? true : active.id === id;
  const update = (patch: SettingsPatch) => save.mutate(patch);
  return (
    <Page>
      <header className="settings-heading">
        <div>
          <h1 className="font-serif text-display">Settings</h1>
          <p className="mt-2 text-sm text-base-content/55">
            Make Vestra feel like yours.
          </p>
        </div>
        <span
          className="text-xs text-base-content/50"
          role="status"
          aria-live="polite"
        >
          {save.isPending
            ? "Saving changes…"
            : save.isSuccess
              ? "Changes saved"
              : "Saved on this computer"}
        </span>
      </header>
      <div className="settings-workspace">
        <aside className="settings-navigation">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-base-content/40" />
            <input
              className="input w-full pl-9"
              type="search"
              aria-label="Search settings"
              placeholder="Search settings"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <nav aria-label="Settings sections" className="mt-4 grid gap-1">
            {[...SECTIONS]
              .sort(
                (a, b) =>
                  [
                    "app",
                    "playback",
                    "torrents",
                    "connections",
                    "diagnostics",
                    "updates",
                    "interface",
                    "library",
                  ].indexOf(a.id) -
                  [
                    "app",
                    "playback",
                    "torrents",
                    "connections",
                    "diagnostics",
                    "updates",
                    "interface",
                    "library",
                  ].indexOf(b.id),
              )
              .map((section) => (
                <div key={section.id} className="grid">
                  {["app", "interface", "library"].includes(section.id) && (
                    <p className="px-3 pt-4 pb-1 text-xs uppercase tracking-wider text-base-content/40">
                      {section.id === "app"
                        ? "Application"
                        : section.id === "interface"
                          ? "Interface & Appearance"
                          : "Library & Scanning"}
                    </p>
                  )}
                  <button
                    type="button"
                    className="settings-nav-item"
                    key={section.id}
                    aria-current={active.id === section.id ? "page" : undefined}
                    onClick={() => {
                      setSearch("");
                      save.reset();
                      void navigate(`/settings?section=${section.id}`);
                    }}
                  >
                    <section.icon className="size-4 shrink-0" />
                    <span>
                      <span className="block text-sm font-medium">
                        {section.label}
                      </span>
                      <span className="mt-1 block text-xs text-base-content/45">
                        {section.description}
                      </span>
                    </span>
                  </button>
                </div>
              ))}
          </nav>
        </aside>
        <div
          className="settings-content"
          data-searching={!!search.trim()}
          key={active.id}
        >
          <div className="mb-6">
            <h2 className="font-serif text-3xl">
              {search.trim() ? "Search results" : active.label}
            </h2>
            <p className="mt-2 text-sm text-base-content/50">
              {search.trim()
                ? "Matching preferences across all categories"
                : active.description}
            </p>
          </div>
          {isPending && (
            <div role="status" className="space-y-4 py-6">
              <div className="h-28 animate-pulse rounded-box bg-base-200" />
              <p>Loading settings…</p>
            </div>
          )}
          {error && (
            <p role="alert">
              Could not load settings.{" "}
              <button
                className="underline"
                onClick={() =>
                  void cache.invalidateQueries({ queryKey: keys.settings })
                }
              >
                Retry
              </button>
            </p>
          )}
          {save.error && (
            <p
              role="alert"
              className="mb-5 rounded-field border border-error/30 p-3 text-sm text-error"
            >
              Your change could not be saved. Please try again.
            </p>
          )}
          {settings && (
            <SettingsSearchContext.Provider value={search}>
              <fieldset
                disabled={save.isPending}
                className="min-w-0 disabled:opacity-65"
              >
                {showing("interface") && (
                  <>
                    <InterfaceSettings settings={settings} update={update} />
                    <AppearancePreferences
                      settings={settings}
                      update={update}
                    />
                  </>
                )}
                {showing("app") && (
                  <>
                    <section className="settings-section">
                      <Setting
                        label="Start page"
                        description="Where Vestra opens on the next launch."
                      >
                        <select
                          aria-label="Start page"
                          className="select"
                          value={settings.app.startupPage}
                          onChange={(e) =>
                            update({
                              app: {
                                startupPage: e.target
                                  .value as Settings["app"]["startupPage"],
                              },
                            })
                          }
                        >
                          {[
                            ["/", "Home"],
                            ["/discover", "Discover"],
                            ["/anime", "Anime"],
                            ["/manga", "Manga"],
                            ["/films", "Films"],
                            ["/series", "Series"],
                            ["/library", "Library"],
                          ].map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Setting>
                      <Switch
                        label="Show status bar"
                        description="Keep library counts and update notices along the bottom."
                        checked={settings.app.showStatusBar}
                        onChange={(v) => update({ app: { showStatusBar: v } })}
                      />
                    </section>
                    <ApplicationPreferences
                      settings={settings}
                      update={update}
                    />
                    <section className="settings-section">
                      <h3 className="font-serif text-2xl">This workspace</h3>
                      <Row
                        label="Data directory"
                        value={diagnostics?.dataDir ?? "Loading…"}
                        mono
                      />
                      <Row
                        label="Files indexed"
                        value={String(diagnostics?.counts.localFiles ?? 0)}
                      />
                      <Row
                        label="Media folders"
                        value={String(settings.library.folders.length)}
                      />
                    </section>
                  </>
                )}
                {showing("playback") && (
                  <PlaybackSettings settings={settings} update={update} />
                )}
                {showing("torrents") && (
                  <>
                    <section className="settings-section">
                      <Switch
                        label="Enable qBittorrent"
                        description="Connect Vestra's Downloads page to your own torrent client."
                        checked={settings.downloads.qbittorrentEnabled}
                        onChange={(v) =>
                          update({ downloads: { qbittorrentEnabled: v } })
                        }
                      />
                      <Setting
                        label="Download category"
                        description="Vestra lists and controls transfers only in this category."
                      >
                        <CommitText
                          label="Download category"
                          value={settings.downloads.category}
                          onCommit={(v) =>
                            update({ downloads: { category: v } })
                          }
                        />
                      </Setting>
                      <Setting
                        label="Refresh transfers"
                        description="Poll only while Downloads is open."
                      >
                        <select
                          aria-label="Refresh transfers"
                          className="select"
                          value={settings.downloads.pollIntervalMs}
                          onChange={(e) =>
                            update({
                              downloads: {
                                pollIntervalMs: Number(e.target.value),
                              },
                            })
                          }
                        >
                          {[3000, 5000, 10000, 30000].map((v) => (
                            <option key={v} value={v}>
                              {v / 1000} seconds
                            </option>
                          ))}
                        </select>
                      </Setting>
                    </section>
                    <TorrentConnection />
                  </>
                )}
                {showing("library") && (
                  <>
                    {(!search.trim() ||
                      /folder|director|primary|additional|local library/i.test(
                        search,
                      )) && <MediaFolders />}
                    <LibraryPreferences settings={settings} update={update} />
                  </>
                )}
                {!search.trim() && showing("connections") && <TmdbConnection />}
                {!search.trim() && showing("diagnostics") && (
                  <>
                    <SourceHealthPanel />
                    <PlaybackDiagnosticsPanel />
                  </>
                )}
                {!search.trim() && showing("updates") && <AppUpdatesPanel />}
              </fieldset>
            </SettingsSearchContext.Provider>
          )}
        </div>
      </div>
    </Page>
  );
}
function Setting({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  const matches = useSettingMatch(label, description);
  if (!matches) return null;
  return (
    <div className="settings-row">
      <div>
        <h3 className="text-sm font-medium">{label}</h3>
        {description && (
          <p className="mt-1 max-w-md text-sm text-base-content/50">
            {description}
          </p>
        )}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}
function Switch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Setting label={label} description={description}>
      <input
        className="toggle toggle-primary"
        aria-label={label}
        role="switch"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </Setting>
  );
}
function CommitText({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim() && draft.trim() !== value) onCommit(draft.trim());
      }}
    >
      <input
        aria-label={label}
        required
        maxLength={100}
        className="input min-w-0 w-36"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        type="submit"
        className="btn btn-sm"
        disabled={!draft.trim() || draft === value}
      >
        Save
      </button>
    </form>
  );
}
function InterfaceSettings({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: SettingsPatch) => void;
}) {
  const value = settings.appearance;
  return (
    <>
      <section className="settings-preview" aria-label="Interface preview">
        <div className="settings-preview-rule" />
        <p className="text-xs text-base-content/50">Your workspace, your way</p>
        <p className="mt-3 font-serif text-4xl">A place for every story.</p>
        <div className="mt-5 flex items-center gap-4">
          <span className="rounded-field bg-primary px-4 py-2 text-sm text-primary-content">
            Continue watching
          </span>
          <span className="text-sm text-base-content/45">
            Live appearance preview
          </span>
        </div>
      </section>
      <section className="settings-section">
        <Setting
          label="Theme"
          description="Choose a look, or follow your computer."
        >
          <div className="join" role="group" aria-label="Theme">
            {(["dark", "light", "system"] as const).map((theme) => (
              <button
                key={theme}
                className={`btn btn-sm join-item ${value.theme === theme ? "btn-primary" : ""}`}
                aria-pressed={value.theme === theme}
                onClick={() => update({ appearance: { theme } })}
              >
                {theme[0]!.toUpperCase() + theme.slice(1)}
              </button>
            ))}
          </div>
        </Setting>
        <Setting
          label="Accent color"
          description="Vestra's original vermillion, or your own accent."
        >
          <select
            aria-label="Accent color"
            className="select"
            value={value.customizeAccent ? value.accent : "vestra"}
            onChange={(e) =>
              update({
                appearance: {
                  customizeAccent: true,
                  accent: e.target.value as Settings["appearance"]["accent"],
                  customAccent: null,
                },
              })
            }
          >
            {ACCENT_PRESETS.map((accent) => (
              <option key={accent} value={accent}>
                {accent === "vestra"
                  ? "Vestra vermillion"
                  : accent[0]!.toUpperCase() + accent.slice(1)}
              </option>
            ))}
          </select>
        </Setting>
        <Setting
          label="Text size"
          description="Scale the interface without changing your screen resolution."
        >
          <select
            aria-label="Text size"
            className="select"
            value={value.textScale}
            onChange={(e) =>
              update({
                appearance: {
                  textScale: e.target
                    .value as Settings["appearance"]["textScale"],
                },
              })
            }
          >
            <option value="small">Small</option>
            <option value="default">Default</option>
            <option value="large">Large</option>
          </select>
        </Setting>
        <Switch
          label="Show navigation labels"
          description="Expand the icon rail into a labeled sidebar."
          checked={value.sidebarLabels}
          onChange={(sidebarLabels) =>
            update({ appearance: { sidebarLabels } })
          }
        />
        <Switch
          label="Glass effects"
          description="Use blurred surfaces behind floating controls."
          checked={value.glassEffects}
          onChange={(glassEffects) => update({ appearance: { glassEffects } })}
        />
        <Switch
          label="Reduce motion"
          description="Keep transitions and loading animations minimal."
          checked={value.reducedMotion}
          onChange={(reducedMotion) =>
            update({ appearance: { reducedMotion } })
          }
        />
      </section>
      <div className="flex justify-end">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => update({ appearance: DEFAULT_SETTINGS.appearance })}
        >
          Reset interface
        </button>
      </div>
    </>
  );
}
function PlaybackSettings({
  settings,
  update,
}: {
  settings: Settings;
  update: (patch: SettingsPatch) => void;
}) {
  const value = settings.playback;
  const toggle = (
    key:
      "autoplayNext" | "skipSegments" | "autoSkipSegments" | "rememberPosition",
    label: string,
    description: string,
  ) => (
    <Switch
      key={key}
      label={label}
      description={description}
      checked={value[key]}
      onChange={(v) => update({ playback: { [key]: v } })}
    />
  );
  return (
    <section className="settings-section">
      {toggle(
        "autoplayNext",
        "Play the next episode",
        "Continue automatically when the current episode ends.",
      )}
      {toggle(
        "rememberPosition",
        "Remember playback position",
        "Resume where you left off.",
      )}
      {toggle(
        "skipSegments",
        "Show opening and ending skips",
        "Offer a skip control when timestamps are available.",
      )}
      {toggle(
        "autoSkipSegments",
        "Skip openings and endings automatically",
        "Use the available timestamps without asking each time.",
      )}
      <Setting
        label="Hardware decoding"
        description="Choose automatic safe decoding or software playback. Restart Vestra to apply a decoder change."
      >
        <select
          aria-label="Hardware decoding"
          className="select"
          value={value.hardwareDecoding}
          onChange={(e) =>
            update({
              playback: {
                hardwareDecoding: e.target
                  .value as Settings["playback"]["hardwareDecoding"],
              },
            })
          }
        >
          <option value="auto-safe">Automatic (safe)</option>
          <option value="auto">Automatic</option>
          <option value="no">Software</option>
        </select>
      </Setting>
      <Setting
        label="Seek step"
        description="Seconds moved by the player's skip controls."
      >
        <select
          aria-label="Seek step"
          className="select"
          value={value.seekStepSeconds}
          onChange={(e) =>
            update({ playback: { seekStepSeconds: Number(e.target.value) } })
          }
        >
          {[5, 10, 15, 30, 60].map((v) => (
            <option key={v} value={v}>
              {v} seconds
            </option>
          ))}
        </select>
      </Setting>
    </section>
  );
}

function TmdbConnection() {
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ["tmdb-credentials"],
    queryFn: bridge.settings.tmdbStatus,
  });
  const [accessToken, setAccessToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const save = useMutation({
    mutationFn: bridge.settings.saveTmdb,
    onSuccess: async (_, value) => {
      setAccessToken("");
      setApiKey("");
      setMessage(
        value
          ? "TMDb credentials saved. The new configuration applies immediately."
          : "Saved credentials removed. Environment configuration applies if present.",
      );
      await client.invalidateQueries();
    },
  });
  return (
    <section className="mt-10">
      <SectionRule label="TMDb connection" />
      <p className="mt-3 text-sm text-base-content/60">
        Movie and series metadata. Use an API Read Access Token (recommended) or
        a v3 API key from{" "}
        <a
          className="link"
          href="https://www.themoviedb.org/settings/api"
          target="_blank"
          rel="noreferrer"
        >
          your TMDb account
        </a>
        . Credentials are encrypted on this computer and kept outside
        extensions.
      </p>
      <p className="my-3 meta" role="status">
        {status.isPending
          ? "Checking connection configuration…"
          : status.data?.configured
            ? `Configured through ${status.data.source}`
            : "Not configured"}
      </p>
      {status.data?.loadError && (
        <p role="alert" className="text-sm text-warning">
          Saved credentials could not be opened. Enter them again or remove the
          saved connection.
        </p>
      )}
      {status.error && <p role="alert">Could not read connection settings.</p>}
      <form
        className="mt-4 grid max-w-xl gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMessage("");
          save.mutate({ accessToken, apiKey });
        }}
      >
        <label className="grid gap-1 text-sm">
          API Read Access Token
          <input
            className="input input-bordered w-full"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="Enter a new token"
            disabled={save.isPending}
          />
        </label>
        <label className="grid gap-1 text-sm">
          API key (v3)
          <input
            className="input input-bordered w-full"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Or enter a v3 key"
            disabled={save.isPending}
          />
        </label>
        <div className="flex gap-2">
          <button
            className="btn btn-primary btn-sm"
            disabled={
              save.isPending ||
              !status.data?.encryptionAvailable ||
              !(accessToken.trim() || apiKey.trim())
            }
          >
            {save.isPending ? "Saving…" : "Save connection"}
          </button>
          {(status.data?.saved || status.data?.loadError) && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={save.isPending}
              onClick={() => {
                setMessage("");
                save.mutate(null);
              }}
            >
              Remove saved credentials
            </button>
          )}
        </div>
      </form>
      {status.data && !status.data.encryptionAvailable && (
        <p role="alert" className="mt-3 text-sm">
          Secure storage is unavailable. Configure TMDB_ACCESS_TOKEN or
          TMDB_API_KEY in the environment.
        </p>
      )}
      {save.error && (
        <p role="alert" className="mt-3 text-sm text-error">
          {save.error.message}
        </p>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-success">
          {message}
        </p>
      )}
    </section>
  );
}

/**
 * Media folders.
 *
 * The only genuinely writable part of Settings, and the one that matters: with
 * no folder configured the local library can never contain anything, which
 * makes the rest of the app a metadata browser.
 */
function MediaFolders() {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [rematched, setRematched] = useState<{
    matched: number;
    unmatched: number;
    reidentified: number;
    remapped: number;
  } | null>(null);

  const { data: folders = [] } = useQuery({
    queryKey: ["library-folders"],
    queryFn: () => bridge.library.folders(),
  });

  const folderStatus = useQuery({
    queryKey: ["library-folder-status"],
    queryFn: bridge.settings.folderStatus,
    refetchInterval: 30000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.settings });
    void queryClient.invalidateQueries({ queryKey: ["library-folder-status"] });
    void queryClient.invalidateQueries({ queryKey: ["library-folders"] });
    void queryClient.invalidateQueries({ queryKey: keys.library });
    void queryClient.invalidateQueries({ queryKey: keys.libraryEntries });
    void queryClient.invalidateQueries({ queryKey: keys.diagnostics });
  };

  const pick = useMutation({
    mutationFn: () => bridge.library.pickFolder(),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => bridge.library.removeFolder(id),
    onSuccess: refresh,
  });

  const scan = useMutation({
    mutationFn: () => bridge.library.scan(),
    onSuccess: (result) => {
      setSummary(result);
      refresh();
    },
  });

  /**
   * Identify everything again from scratch.
   *
   * A scan leaves files that already carry a match alone, so a library built
   * by an earlier version keeps whatever it was given — including matches made
   * before the matcher knew that each anime season is a separate entry.
   */
  const rematch = useMutation({
    mutationFn: () => bridge.library.rematch(),
    onSuccess: (result) => {
      setRematched(result);
      refresh();
    },
  });

  return (
    <section className="mt-10">
      <SectionRule
        label="Media folders"
        count={folders.length}
        trailing={
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pick.isPending}
              onClick={() => pick.mutate()}
              className="flex items-center gap-1.5 rounded-field border rule px-2.5 py-1 text-xs transition-colors hover:border-primary/40 hover:text-primary"
            >
              <FolderPlus className="size-3.5" />
              Add
            </button>
            <button
              type="button"
              // Not gated on folders: this re-reads the existing index rather
              // than the disk, and an index can outlive the folder it came from.
              disabled={rematch.isPending}
              onClick={() => rematch.mutate()}
              title="Look up every file again, replacing existing matches"
              className="flex items-center gap-1.5 rounded-field border rule px-2.5 py-1 text-xs transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              {rematch.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Wand2 className="size-3.5" />
              )}
              Re-identify
            </button>
            <button
              type="button"
              disabled={scan.isPending || folders.length === 0}
              onClick={() => scan.mutate()}
              className="flex items-center gap-1.5 rounded-field border border-primary/40 px-2.5 py-1 text-xs text-primary transition-colors hover:bg-primary hover:text-primary-content disabled:opacity-40"
            >
              {scan.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Scan
            </button>
          </div>
        }
      />

      {folders.length === 0 ? (
        <Notice
          title="No folders added"
          body="Add a folder and run a scan to index what you own."
        />
      ) : (
        <div>
          {folders.map((folder, index) => (
            <div
              key={folder.id}
              className="group flex items-center gap-4 border-b rule px-2 py-2.5"
            >
              <span
                data-selectable
                className="min-w-0 flex-1 truncate font-mono text-[12px] text-base-content/75"
                title={folder.path}
              >
                {index === 0 ? "Primary · " : "Additional · "}
                {folder.path}
                {folderStatus.data?.find((v) => v.id === folder.id)
                  ?.available === false
                  ? " · Unavailable (records retained)"
                  : ""}
              </span>
              <button
                type="button"
                aria-label="Remove folder"
                onClick={() => remove.mutate(folder.id)}
                className="grid size-7 place-items-center rounded-field text-base-content/40 opacity-0 transition-all hover:bg-error hover:text-error-content group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {(pick.error || remove.error) && (
        <p role="alert" className="text-error">
          {(pick.error || remove.error)?.message}
        </p>
      )}
      {scan.error ? (
        <p className="mt-3 text-xs text-error">
          {(scan.error as Error).message}
        </p>
      ) : null}

      {rematch.error ? (
        <p className="mt-3 text-xs text-error">
          {(rematch.error as Error).message}
        </p>
      ) : null}

      {rematched ? (
        <p className="meta mt-3">
          {rematched.matched} matched · {rematched.unmatched} unmatched ·{" "}
          {rematched.reidentified} re-identified
          {rematched.remapped > 0
            ? ` · ${rematched.remapped} kept their progress`
            : ""}
        </p>
      ) : null}

      {summary ? (
        <p className="meta mt-3">
          {summary.scanned} scanned · {summary.added} added · {summary.removed}{" "}
          removed · {summary.matched} matched · {summary.unmatched} unmatched
          {summary.errors.length > 0
            ? ` · ${summary.errors.length} errors`
            : ""}
        </p>
      ) : null}
    </section>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b rule px-2 py-2.5">
      <span className="text-sm text-base-content/60">{label}</span>
      <span
        data-selectable
        className={[
          "truncate text-right text-sm",
          mono ? "font-mono text-[12px] text-base-content/75" : "",
        ].join(" ")}
      >
        {value}
      </span>
    </div>
  );
}

/* =============================================================================
 * Extensions live in their own route file — see routes/extensions.tsx
 * ========================================================================== */
