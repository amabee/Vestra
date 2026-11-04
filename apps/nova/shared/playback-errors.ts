/** Public playback failures contain a stable code, never provider URLs or stack traces. */
const messages = {
  "title-match": {
    title: "This source couldn't match the title",
    message:
      "No unique matching title and release year was found. Search for the title in this source's own browse page, or choose another source.",
  },
  interrupted: {
    title: "Playback was interrupted",
    message:
      "The video source stopped responding. Try again, or choose another source from the details page.",
  },
  timeout: {
    title: "The source is taking too long",
    message:
      "We couldn't load this video in time. Try again, or choose another source from the details page.",
  },
  network: {
    title: "Unable to reach the video",
    message:
      "Check your connection and try again. If it keeps happening, choose another source from the details page.",
  },
  unavailable: {
    title: "This video isn't available",
    message:
      "This source couldn't provide a playable video. Try another source from the details page, or check for an extension update.",
  },
  player: {
    title: "The player couldn't start",
    message:
      "Close the player and try again. If it keeps happening, restart Vestra.",
  },
  unknown: {
    title: "We couldn't play this video",
    message:
      "Try again. If it keeps happening, choose another source from the details page.",
  },
} as const;
export type PlaybackErrorCode = keyof typeof messages;
export function playbackIssue(error: unknown): {
  code: PlaybackErrorCode;
  title: string;
  message: string;
} {
  const text = error instanceof Error ? error.message : String(error ?? "");
  let code: PlaybackErrorCode = "unknown";
  if (error instanceof PlaybackFailure) code = error.code;
  else {
    const known = (Object.keys(messages) as PlaybackErrorCode[]).find(
      (key) => messages[key].message === text,
    );
    if (known) code = known;
    else if (/no exact match|multiple source editions match/i.test(text))
      code = "title-match";
    else if (/timed? out|timeout|deadline|time limit/i.test(text))
      code = "timeout";
    else if (
      /worker.*(?:stopped|exited)|session stopped|provider.*disabled|shutting down|cancelled|aborted/i.test(
        text,
      )
    )
      code = "interrupted";
    else if (
      /network|fetch failed|ENOTFOUND|ECONN|internet|offline/i.test(text)
    )
      code = "network";
    else if (
      /no playable|no scraper|unsupported.*(?:host|embed)|403|404|unavailable|not found/i.test(
        text,
      )
    )
      code = "unavailable";
    else if (/mpv|player.*(?:start|exit)/i.test(text)) code = "player";
  }
  return { code, ...messages[code] };
}
export class PlaybackFailure extends Error {
  constructor(readonly code: PlaybackErrorCode) {
    super(messages[code].message);
    this.name = "PlaybackFailure";
  }
}
export function playbackFailureReply(error: unknown) {
  const issue = playbackIssue(error);
  return { playbackFailure: issue.code };
}
export function unwrapPlaybackReply<T>(reply: unknown): T {
  if (reply && typeof reply === "object" && "playbackFailure" in reply) {
    const code = (reply as { playbackFailure: unknown }).playbackFailure;
    throw new PlaybackFailure(
      typeof code === "string" && Object.hasOwn(messages, code)
        ? (code as PlaybackErrorCode)
        : "unknown",
    );
  }
  return reply as T;
}
