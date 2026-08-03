import type { MediaSource } from "@vestra/types";

/**
 * A provider call that failed.
 *
 * Universal search catches these per-source so one dead provider degrades that
 * group only, instead of failing the whole query.
 */
export class ProviderError extends Error {
  readonly source: MediaSource;
  readonly status: number | null;

  constructor(
    source: MediaSource,
    message: string,
    options: { status?: number | null; cause?: unknown } = {},
  ) {
    // `cause` is forwarded to Error rather than redeclared, so it stays a
    // single property instead of shadowing the built-in one.
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ProviderError";
    this.source = source;
    this.status = options.status ?? null;
  }

  /** True when retrying later might succeed (timeout, rate limit, 5xx). */
  get isTransient(): boolean {
    if (this.status === null) return true;
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export class ProviderNotConfiguredError extends ProviderError {
  constructor(source: MediaSource, hint: string) {
    super(source, `${source} is not configured. ${hint}`, { status: null });
    this.name = "ProviderNotConfiguredError";
  }

  override get isTransient(): boolean {
    return false;
  }
}

/** Normalise any thrown value into a user-safe message (never leaks secrets). */
export function toProviderMessage(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "The request timed out.";
    }
    return error.message;
  }
  return "An unknown error occurred.";
}
