import { playbackIssue } from "../../../shared/playback-errors";

export interface ProblemReportContext {
  area: string;
  source?: string;
  error?: unknown;
}

/** Reports contain selected public fields, never raw errors, logs or stream URLs. */
export function problemReportUrl(
  context: ProblemReportContext,
  version: string,
  platform: string,
): string {
  const field = (value: string) =>
    value.replace(/[^a-zA-Z0-9 ._+()-]/g, "").slice(0, 100);
  const issue = context.error ? playbackIssue(context.error) : undefined;
  const body = [
    "### What happened?",
    "Please describe the problem and the title/episode, if relevant.",
    "",
    "### Steps to reproduce",
    "1. ",
    "",
    "### Expected behavior",
    "",
    "### App details",
    `- Nova: ${field(version)}`,
    `- Platform: ${field(platform)}`,
    `- Area: ${field(context.area)}`,
    `- Source: ${field(context.source ?? "Not specified")}`,
    ...(issue
      ? [`- Error code: ${issue.code}`, `- Message: ${issue.message}`]
      : []),
    "",
    "Review this report before submitting. Add screenshots if helpful; remove private information.",
  ].join("\n");
  const url = new URL("https://github.com/amabee/Vestra/issues/new");
  url.searchParams.set(
    "title",
    `[Bug] ${field(context.area)}${context.source ? ` (${field(context.source)})` : ""}`,
  );
  url.searchParams.set("body", body);
  return url.href;
}
