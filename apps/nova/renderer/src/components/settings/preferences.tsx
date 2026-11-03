import { AniListConnection } from "./anilist-connection";
import { useSettingMatch } from "./search";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_SETTINGS,
  scannerConfigSchema,
  type Settings,
  type SettingsPatch,
} from "@vestra/types";
import { bridge } from "@/lib/bridge";
import { keys } from "@/lib/queries";

type Props = { settings: Settings; update: (patch: SettingsPatch) => void };
export const preferenceGroups = [
  {
    title: "Navigation & layout",
    fields: [
      ["expandSidebarOnHover", "Expand sidebar on hover"],
      ["opaqueSidebar", "Disable sidebar transparency"],
      ["hideTopNavbar", "Hide top navbar search"],
      ["removeGenreSelector", "Remove genre selector"],
    ],
  },
  {
    title: "Visual effects",
    fields: [
      ["mediaBlurredBackground", "Media screen blurred background"],
      ["mediaCardGlass", "Media card glassy background"],
    ],
  },
  {
    title: "Episode presentation",
    fields: [
      ["episodeCards", "Episode cards"],
      ["hideEpisodeSummary", "Hide episode item summary"],
      ["hideEpisodeFilename", "Hide episode item filename"],
      ["smallerEpisodeCards", "Smaller episode cards"],
    ],
  },
] as const;
export function PreferenceRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
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
function Toggle({
  label,
  checked,
  disabled,
  change,
  description,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  change: (v: boolean) => void;
  description?: string;
}) {
  return (
    <PreferenceRow label={label} description={description}>
      <input
        aria-label={label}
        role="switch"
        type="checkbox"
        className="toggle toggle-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => change(e.target.checked)}
      />
    </PreferenceRow>
  );
}
export function ApplicationPreferences({ settings: s, update }: Props) {
  const sources = useQuery({
    queryKey: ["anime-sources"],
    queryFn: bridge.anime.sources,
  });
  const privacy = (
    key: keyof Settings["privacy"],
    label: string,
    description?: string,
    disabled = false,
  ) => (
    <Toggle
      key={key}
      label={label}
      description={description}
      checked={Boolean(s.privacy[key])}
      disabled={disabled}
      change={(v) => update({ privacy: { [key]: v } })}
    />
  );
  return (
    <>
      <section className="settings-section">
        <h3 className="font-serif text-2xl">Playback & history</h3>
        <Toggle
          label="Automatically update watch progress"
          description="Save positions and update planned titles from actual playback. Manual episode marking stays available."
          checked={s.playback.autoUpdateProgress}
          change={(v) => update({ playback: { autoUpdateProgress: v } })}
        />
        {privacy(
          "trackHistory",
          "Enable watch history",
          "Keep a viewing history independently of saved playback progress. Existing history is retained when disabled.",
        )}
        <PreferenceRow
          label="Default episode source"
          description="Used for fresh navigation. A removed source falls back to an available source."
        >
          <select
            className="select"
            aria-label="Default episode source"
            value={s.playback.defaultEpisodeSource ?? ""}
            onChange={(e) =>
              update({
                playback: { defaultEpisodeSource: e.target.value || null },
              })
            }
          >
            <option value="">Remember last source</option>
            <option value="local">Local library</option>
            {s.playback.defaultEpisodeSource &&
              s.playback.defaultEpisodeSource !== "local" &&
              !sources.data?.some(
                (v) => v.id === s.playback.defaultEpisodeSource,
              ) && (
                <option value={s.playback.defaultEpisodeSource}>
                  Unavailable source
                </option>
              )}
            {sources.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </PreferenceRow>
      </section>
      <section className="settings-section">
        <h3 className="font-serif text-2xl">Anime preferences</h3>
        {privacy(
          "hideAnimeSpoilers",
          "Hide anime spoilers",
          "Hide episode artwork, titles and summaries and collapse series synopses.",
        )}
        {privacy("hideAudienceScores", "Hide audience scores")}
        {privacy(
          "showAdultContent",
          "Enable adult content",
          "Allow titles identified as 18+ on supported catalogue surfaces. Public discovery feeds remain filtered by their provider.",
        )}
        {privacy(
          "blurAdultContent",
          "Blur adult content",
          "Blur artwork of titles identified as 18+.",
          !s.privacy.showAdultContent,
        )}
        {privacy(
          "animeUnwatchedCount",
          "Anime card unwatched count",
          "Count available episodes against recorded completions. Unknown episode inventories stay unlabelled.",
        )}
        {privacy(
          "mangaUnreadCount",
          "Manga card unread count",
          "Count known source chapters against recorded completions. Open manga details to load chapters and reconcile legacy history.",
        )}
        <p className="text-sm text-base-content/50">
          Anime cards currently have no trailer playback.
        </p>
      </section>
      <section className="settings-section">
        <h3 className="font-serif text-2xl">Extensions</h3>
        <Toggle
          label="Enable Extension Secure Mode"
          description="Block QuickJS extensions granted source sessions, library or progress access. Basic network sources continue to work. Isolation, host allowlists and private-network protection always stay enabled. Provider worker sources keep their existing host policy."
          checked={s.extensions.secureMode}
          change={(v) => update({ extensions: { secureMode: v } })}
        />
      </section>
      <AniListConnection settings={s} update={update} />
    </>
  );
}
function ColorControl({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <PreferenceRow
      label={label}
      description="Applied immediately. Accent brightness adapts when needed for readable text."
    >
      <div className="flex gap-2">
        <input
          aria-label={`${label} picker`}
          type="color"
          value={value}
          onChange={(e) => change(e.target.value)}
        />
        <input
          key={value}
          className="input w-28"
          aria-label={`${label} hex`}
          defaultValue={value}
          pattern="#[0-9a-fA-F]{6}"
          maxLength={7}
          onChange={(e) => {
            setDraft(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value))
              change(e.target.value);
          }}
          aria-invalid={draft !== value && !/^#[0-9a-fA-F]{6}$/.test(draft)}
        />
      </div>
    </PreferenceRow>
  );
}
function Select({
  label,
  value,
  options,
  change,
  description,
}: {
  label: string;
  value: string;
  options: readonly string[];
  change: (v: string) => void;
  description?: string;
}) {
  return (
    <PreferenceRow label={label} description={description}>
      <select
        aria-label={label}
        className="select"
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        {options.map((v) => (
          <option key={v} value={v}>
            {v.replaceAll("-", " ")}
          </option>
        ))}
      </select>
    </PreferenceRow>
  );
}
export function AppearancePreferences({ settings: s, update }: Props) {
  const a = s.appearance;
  const set = (key: keyof Settings["appearance"], value: unknown) =>
    update({ appearance: { [key]: value } });
  return (
    <>
      <section className="settings-section">
        <h3 className="font-serif text-2xl">Custom colors</h3>
        <ColorControl
          label="Background color"
          value={a.backgroundColor ?? "#181714"}
          change={(v) => set("backgroundColor", v)}
        />
        <ColorControl
          label="Custom accent color"
          value={a.customAccent ?? "#e96545"}
          change={(v) =>
            update({ appearance: { customAccent: v, customizeAccent: true } })
          }
        />
        <button
          className="btn btn-sm"
          onClick={() =>
            update({
              appearance: {
                backgroundColor: null,
                customAccent: null,
                customizeAccent: false,
              },
            })
          }
        >
          Reset colors
        </button>
      </section>
      <section className="settings-section">
        <h3 className="font-serif text-2xl">Banners & backgrounds</h3>
        {(["backgroundImage", "bannerImage"] as const).map((key) => (
          <PreferenceRow
            key={key}
            label={
              key === "backgroundImage"
                ? "Background image path"
                : "Banner image path"
            }
            description="Choose a local image through the native file dialog."
          >
            <div className="flex gap-2">
              <span className="max-w-48 truncate text-xs" title={a[key]}>
                {a[key] || "No image"}
              </span>
              <button
                className="btn btn-sm"
                onClick={() =>
                  void bridge.settings.pickImage().then((path) => {
                    if (path) set(key, path);
                  })
                }
              >
                Choose image
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={!a[key]}
                onClick={() => set(key, "")}
              >
                Clear
              </button>
            </div>
          </PreferenceRow>
        ))}
        {(["backgroundOpacity", "bannerOpacity"] as const).map((key) => (
          <PreferenceRow
            key={key}
            label={
              key === "backgroundOpacity"
                ? "Background image opacity"
                : "Banner opacity"
            }
          >
            <div className="flex gap-2">
              <input
                aria-label={
                  key === "backgroundOpacity"
                    ? "Background image opacity"
                    : "Banner opacity"
                }
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={a[key]}
                onChange={(e) => set(key, Number(e.target.value))}
              />
              <output>{Math.round(a[key] * 100)}%</output>
            </div>
          </PreferenceRow>
        ))}
        <Select
          label="Banner position"
          value={a.bannerPosition}
          options={["top", "center", "bottom"]}
          change={(v) => set("bannerPosition", v)}
        />
        <Select
          label="Home screen banner type"
          value={a.homeBanner}
          options={["dynamic", "custom", "none"]}
          change={(v) => set("homeBanner", v)}
        />
        <Select
          label="Media screen banner appearance"
          value={a.mediaBannerAppearance}
          options={[
            "default",
            "blur-available",
            "dim-unavailable",
            "hide-unavailable",
            "dim",
            "blur",
            "hide",
          ]}
          change={(v) => set("mediaBannerAppearance", v)}
        />
        <Select
          label="Media screen banner size"
          value={a.mediaBannerSize}
          options={["large", "medium", "small"]}
          change={(v) => set("mediaBannerSize", v)}
        />
      </section>
      <section className="settings-section">
        <h3 className="font-serif text-2xl">Sorting</h3>
        {(
          [
            [
              "continueWatchingSort",
              "Continue Watching",
              ["updated", "alphabetical"],
            ],
            [
              "animeLibrarySort",
              "Anime Library",
              ["added", "alphabetical", "release"],
            ],
            ["mangaLibrarySort", "Manga Library", ["updated", "alphabetical"]],
          ] as const
        ).map(([key, label, options]) => (
          <Select
            key={key}
            label={label}
            value={a[key]}
            options={options}
            description={
              key === "mangaLibrarySort"
                ? "Updated uses bookmark save time; alphabetical uses title."
                : "Only orders supported by saved metadata are offered."
            }
            change={(v) => set(key, v)}
          />
        ))}
      </section>
      <p className="mb-5 text-sm text-base-content/50">
        Carousels currently advance only when you use their controls. Automatic
        carousel scrolling is not enabled in this version.
      </p>
      {preferenceGroups.map((group) => (
        <section className="settings-section" key={group.title}>
          <h3 className="font-serif text-2xl">{group.title}</h3>
          {group.fields.map(([key, label]) => (
            <Toggle
              key={key}
              label={label}
              checked={a[key]}
              disabled={key === "mediaBlurredBackground" && !a.glassEffects}
              change={(v) => set(key, v)}
            />
          ))}
        </section>
      ))}
      <section className="settings-section">
        <Select
          label="Navigation preloading"
          value={a.navigationPreloading}
          options={["disabled", "intent", "faster-intent", "viewport"]}
          description="Preload the lazy Settings and Downloads pages on hover/focus or when navigation enters the viewport."
          change={(v) => set("navigationPreloading", v)}
        />
        <PreferenceRow
          label="Unpinned menu items"
          description="Move selected destinations into the More menu. Home and Settings stay reachable."
        >
          <select
            className="select h-36"
            multiple
            aria-label="Unpinned menu items"
            value={a.unpinnedMenuItems}
            onChange={(e) =>
              set(
                "unpinnedMenuItems",
                Array.from(e.target.selectedOptions, (o) => o.value),
              )
            }
          >
            {[
              "discover",
              "schedule",
              "anime",
              "manga",
              "films",
              "series",
              "downloads",
              "library",
              "watchlist",
              "history",
              "extensions",
            ].map((v) => (
              <option key={v} value={`/${v}`}>
                {v}
              </option>
            ))}
          </select>
        </PreferenceRow>
      </section>
    </>
  );
}
export function LibraryPreferences({ settings: s, update }: Props) {
  const scannerMatch = useSettingMatch(
    "Advanced scanner configuration JSON import export restore default",
  );
  const cache = useQueryClient();
  const [draft, setDraft] = useState(
    JSON.stringify(s.library.scanner, null, 2),
  );
  const [message, setMessage] = useState("");
  let parsed: ReturnType<typeof scannerConfigSchema.parse> | undefined;
  let problem = "";
  try {
    parsed = scannerConfigSchema.parse(JSON.parse(draft));
  } catch (e) {
    problem = e instanceof Error ? e.message : "Invalid configuration";
  }
  const transfer = useMutation({
    mutationFn: async (kind: "import" | "export") => {
      const result =
        kind === "import"
          ? await bridge.settings.importLocal()
          : await bridge.settings.exportLocal();
      if (result && typeof result === "object") {
        cache.setQueryData(keys.settings, result);
        setDraft(JSON.stringify(result.library.scanner, null, 2));
      }
      setMessage(
        result
          ? `Configuration ${kind === "import" ? "imported" : "exported"}.`
          : "Canceled.",
      );
    },
  });
  return (
    <>
      <section className="settings-section">
        <h3 className="font-serif text-2xl">Scanning</h3>
        <Toggle
          label="Automatically refresh library"
          description="Check root directories every minute and scan when their metadata changes. Changes deep within existing subfolders may need a manual scan."
          checked={s.library.autoRefresh}
          change={(v) => update({ library: { autoRefresh: v } })}
        />
        <Toggle
          label="Refresh library on startup"
          description="Scan in the background after the window opens."
          checked={s.library.scanOnStartup}
          change={(v) => update({ library: { scanOnStartup: v } })}
        />
        <Toggle
          label="Match metadata automatically"
          checked={s.library.autoMatchMetadata}
          change={(v) => update({ library: { autoMatchMetadata: v } })}
        />
      </section>
      <section
        className="settings-section"
        data-settings-search-match={scannerMatch}
      >
        <h3 className="font-serif text-2xl">Advanced scanner configuration</h3>
        <p className="text-sm text-base-content/50">
          Bounds apply to the next scan. System folders and symlinks are always
          excluded. Existing library records are retained.
        </p>
        <textarea
          aria-label="Scanner configuration JSON"
          aria-invalid={!!problem}
          aria-describedby="scanner-error"
          spellCheck={false}
          className="textarea mt-4 min-h-48 w-full font-mono"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {problem && (
          <p
            id="scanner-error"
            role="alert"
            className="text-sm text-error whitespace-pre-wrap"
          >
            {problem}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            className="btn btn-sm btn-primary"
            disabled={!parsed || !!problem}
            onClick={() => {
              if (parsed) update({ library: { scanner: parsed } });
            }}
          >
            Apply scanner configuration
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              setDraft(
                JSON.stringify(DEFAULT_SETTINGS.library.scanner, null, 2),
              );
              update({
                library: { scanner: DEFAULT_SETTINGS.library.scanner },
              });
            }}
          >
            Restore scanner defaults
          </button>
        </div>
        <p className="my-3 text-sm text-base-content/50">
          Portable configuration includes scan preferences only. Folder paths,
          accounts, credentials and extension permissions are excluded.
        </p>
        <div className="flex gap-2">
          <button
            className="btn btn-sm"
            disabled={transfer.isPending}
            onClick={() => transfer.mutate("export")}
          >
            Export Local Configuration
          </button>
          <button
            className="btn btn-sm"
            disabled={transfer.isPending}
            onClick={() => transfer.mutate("import")}
          >
            Import Local Configuration
          </button>
        </div>
        {transfer.error && (
          <p role="alert" className="text-error">
            {transfer.error.message}
          </p>
        )}
        <p role="status">{message}</p>
      </section>
    </>
  );
}
