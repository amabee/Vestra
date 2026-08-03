/**
 * Filename parsing for the local library.
 *
 * Turns release-style filenames into a title, year, season and episode so files
 * can be matched against TMDb/AniList. Deliberately conservative: when a pattern
 * is ambiguous it returns null rather than guessing wrong.
 */

export interface ParsedFilename {
  title: string | null;
  year: number | null;
  season: number | null;
  episode: number | null;
}

/** Scene tags that mark the end of the title and the start of release metadata. */
const NOISE_PATTERN = new RegExp(
  [
    "\\b(?:2160p|1080p|720p|480p|4k|uhd|hdr10?|hdr|sdr|dolby ?vision|dv)\\b",
    "\\b(?:bluray|blu-ray|bdrip|brrip|dvdrip|webrip|web-?dl|hdtv|hdrip|remux)\\b",
    "\\b(?:x264|x265|h ?264|h ?265|hevc|avc|xvid|divx|av1)\\b",
    "\\b(?:aac|ac3|dts(?:-hd)?|truehd|flac|mp3|eac3|ddp?5[. ]1|atmos)\\b",
    "\\b(?:multi|dual ?audio|subbed|dubbed|raw|uncensored|repack|proper|extended|remastered)\\b",
    "\\b(?:complete|batch|season ?pack)\\b",
  ].join("|"),
  "i",
);

const SEASON_EPISODE_PATTERNS: RegExp[] = [
  // S01E02 / s1e2 / S01.E02
  /\bs(\d{1,2})[\s._-]*e(\d{1,3})\b/i,
  // 1x02
  /\b(\d{1,2})x(\d{1,3})\b/i,
  // Season 1 Episode 2
  /\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b/i,
];

/** Anime style: "Title - 12 [1080p]" or "Title Ep12" — episode only, no season. */
const EPISODE_ONLY_PATTERNS: RegExp[] = [
  /[\s._-]-[\s._-](\d{1,3})(?:v\d)?(?=[\s._[(-]|$)/,
  /\bep(?:isode)?[\s._-]*(\d{1,3})\b/i,
];

const YEAR_PATTERN = /[([]?((?:19|20)\d{2})[)\]]?/;

function cleanTitle(raw: string): string | null {
  const cleaned = raw
    // Drop bracketed release groups and hashes: [SubsPlease], (1080p), {CRC}
    .replace(/[[({][^\])}]*[\])}]/g, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s\-–—]+$/, "")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}

export function parseMediaFilename(fileName: string): ParsedFilename {
  // Strip the extension before anything else.
  const withoutExtension = fileName.replace(/\.[a-z0-9]{2,4}$/i, "");

  let season: number | null = null;
  let episode: number | null = null;
  let titlePart = withoutExtension;

  for (const pattern of SEASON_EPISODE_PATTERNS) {
    const match = pattern.exec(withoutExtension);
    if (match?.[1] && match[2]) {
      season = Number.parseInt(match[1], 10);
      episode = Number.parseInt(match[2], 10);
      titlePart = withoutExtension.slice(0, match.index);
      break;
    }
  }

  if (episode === null) {
    for (const pattern of EPISODE_ONLY_PATTERNS) {
      const match = pattern.exec(withoutExtension);
      if (match?.[1]) {
        episode = Number.parseInt(match[1], 10);
        // Anime numbering has no season marker; treat it as season 1.
        season = 1;
        titlePart = withoutExtension.slice(0, match.index);
        break;
      }
    }
  }

  // A year is only meaningful for the title when it precedes release metadata.
  let year: number | null = null;
  const yearMatch = YEAR_PATTERN.exec(titlePart);
  if (yearMatch?.[1]) {
    year = Number.parseInt(yearMatch[1], 10);
    titlePart = titlePart.slice(0, yearMatch.index);
  }

  // Everything from the first scene tag onward is noise.
  const noiseMatch = NOISE_PATTERN.exec(titlePart);
  if (noiseMatch) {
    titlePart = titlePart.slice(0, noiseMatch.index);
  }

  return {
    title: cleanTitle(titlePart),
    year,
    season,
    episode,
  };
}

/** True when the extension is one the library treats as video. */
export function isVideoFile(fileName: string, extensions: readonly string[]): boolean {
  const match = /\.([a-z0-9]{2,4})$/i.exec(fileName);
  if (!match?.[1]) return false;
  return extensions.includes(match[1].toLowerCase());
}
