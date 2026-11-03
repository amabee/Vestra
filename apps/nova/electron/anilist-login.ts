import { randomBytes, timingSafeEqual } from "node:crypto";
import { ANILIST_OAUTH_AUTHORIZE } from "@vestra/config/constants";
import type { AniListLoginState } from "../shared/anilist-account";

// Public application identity, intentionally shipped with the desktop client.
export const ANILIST_CLIENT_ID = "55841";
export const ANILIST_LOGIN_REDIRECT = "vestra://auth/anilist";
export function isAniListCallback(raw: string): boolean {
  if (raw.length > 12000) return false;
  try {
    const url = new URL(raw);
    return (
      url.protocol === "vestra:" &&
      url.hostname === "auth" &&
      url.pathname === "/anilist" &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}
interface LoginOptions {
  openBrowser(url: string): Promise<unknown>;
  connect(token: string): Promise<unknown>;
  cancelConnect(): Promise<unknown>;
  changed(): void;
  clientId?: string;
  now?: () => number;
}
/** Only the main process sees callback tokens. States are single-use and expire. */
export class AniListBrowserLogin {
  private pending: { state: string; expires: number } | null = null;
  private phase: AniListLoginState["phase"] = "idle";
  private message: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private now: () => number;
  private clientId: string;
  constructor(private options: LoginOptions) {
    this.now = options.now ?? Date.now;
    this.clientId = options.clientId ?? ANILIST_CLIENT_ID;
  }
  private clearPending() {
    this.pending = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private expire() {
    if (this.pending && this.now() >= this.pending.expires) {
      this.clearPending();
      this.phase = "error";
      this.message = "Sign-in timed out. Please try again.";
    }
  }
  snapshot(): AniListLoginState {
    this.expire();
    return {
      configured: /^[1-9]\d{0,11}$/.test(this.clientId),
      phase: this.phase,
      message: this.message,
    };
  }
  async begin() {
    const status = this.snapshot();
    if (!status.configured)
      throw new Error(
        "AniList sign-in is unavailable in this build. Please update Vestra.",
      );
    if (this.phase === "waiting" || this.phase === "connecting") return;
    const generation = ++this.generation;
    const state = randomBytes(32).toString("base64url");
    this.pending = { state, expires: this.now() + 5 * 60000 };
    this.phase = "waiting";
    this.message = null;
    this.timer = setTimeout(() => {
      this.expire();
      this.options.changed();
    }, 5 * 60000);
    this.timer.unref();
    this.options.changed();
    const url = new URL(ANILIST_OAUTH_AUTHORIZE);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("response_type", "token");
    url.searchParams.set("redirect_uri", ANILIST_LOGIN_REDIRECT);
    url.searchParams.set("state", state);
    try {
      await this.options.openBrowser(url.href);
    } catch {
      if (generation === this.generation) {
        this.clearPending();
        this.phase = "error";
        this.message = "Your browser could not be opened. Please try again.";
        this.options.changed();
      }
    }
  }
  async cancel() {
    const connecting = this.phase === "connecting";
    ++this.generation;
    this.clearPending();
    this.phase = "idle";
    this.message = null;
    if (connecting) await this.options.cancelConnect();
    this.options.changed();
  }
  async complete(raw: string): Promise<boolean> {
    if (!isAniListCallback(raw)) return false;
    this.expire();
    if (!this.pending) return false;
    const url = new URL(raw);
    const fragment = new URLSearchParams(url.hash.slice(1));
    const states = [
      ...fragment.getAll("state"),
      ...url.searchParams.getAll("state"),
    ];
    if (states.length !== 1) return false;
    const supplied = Buffer.from(states[0]!);
    const expected = Buffer.from(this.pending.state);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return false;
    const generation = this.generation;
    this.clearPending(); // Consume before verifying the account to reject replay.
    if (fragment.has("error") || url.searchParams.has("error")) {
      this.phase = "error";
      this.message = "AniList sign-in was canceled. You can try again.";
      this.options.changed();
      return true;
    }
    const tokens = fragment.getAll("access_token");
    const types = fragment.getAll("token_type");
    if (
      tokens.length !== 1 ||
      !/^[A-Za-z0-9._~-]{16,8192}$/.test(tokens[0]!) ||
      types.length !== 1 ||
      types[0]!.toLowerCase() !== "bearer" ||
      url.searchParams.has("access_token")
    ) {
      this.phase = "error";
      this.message =
        "AniList returned an invalid sign-in response. Please try again.";
      this.options.changed();
      return true;
    }
    this.phase = "connecting";
    this.message = null;
    this.options.changed();
    try {
      await this.options.connect(tokens[0]!);
      if (generation === this.generation) {
        this.phase = "idle";
        this.message = null;
        this.options.changed();
      }
    } catch {
      if (generation === this.generation) {
        this.phase = "error";
        this.message = "Could not finish AniList sign-in. Please try again.";
        this.options.changed();
      }
    }
    return true;
  }
}
