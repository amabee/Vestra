import { describe, expect, it } from "vitest";

import {
  createBrokeredFetch,
  isChallengeResponse,
  NetworkDeniedError,
  SourceChallengedError,
  type GuardedTransport,
} from "./net";
import { grantCoversRequest, type PermissionGrant } from "./permissions";

/**
 * Detection only. Vestra does not solve challenges, so what is asserted here
 * is that one is recognised and reported rather than parsed as content — the
 * failure mode being avoided is a scraper matching zero results against a
 * challenge page and reporting an empty catalogue.
 */

const grant: PermissionGrant = {
  extensionId: "ext-test",
  granted: ["network"],
  allowedHosts: ["example.com"],
  grantedForVersion: "1.0.0",
  grantedAt: new Date().toISOString(),
};

const transportReturning = (response: {
  status: number;
  headers: Record<string, string>;
  body: string;
}): GuardedTransport => ({
  request: async () => response,
});

const CHALLENGE_BODY =
  '<html><head><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script></head></html>';

describe("isChallengeResponse", () => {
  it("trusts cf-mitigated alone", () => {
    // Cloudflare's own signal. No corroboration needed.
    expect(
      isChallengeResponse({
        status: 403,
        headers: { "cf-mitigated": "challenge" },
        body: "",
      }),
    ).toBe(true);
  });

  it("is case-insensitive about header names", () => {
    expect(
      isChallengeResponse({
        status: 403,
        headers: { "CF-Mitigated": "Challenge" },
        body: "",
      }),
    ).toBe(true);
  });

  it("detects a challenge from status, server and body together", () => {
    expect(
      isChallengeResponse({
        status: 503,
        headers: { server: "cloudflare" },
        body: CHALLENGE_BODY,
      }),
    ).toBe(true);
  });

  it("does not call an ordinary 403 a challenge", () => {
    // A bare 403 is routine. Reporting it as a challenge would send the user
    // looking for the wrong problem.
    expect(
      isChallengeResponse({
        status: 403,
        headers: { server: "cloudflare" },
        body: "<html><body>Forbidden</body></html>",
      }),
    ).toBe(false);
  });

  it("does not fire on a page that merely mentions cloudflare", () => {
    // Body markers are corroboration, not evidence: a 200 discussing
    // Cloudflare is content, not a challenge.
    expect(
      isChallengeResponse({
        status: 200,
        headers: { server: "cloudflare" },
        body: CHALLENGE_BODY,
      }),
    ).toBe(false);
  });

  it("ignores challenge markers from a non-challenge issuer", () => {
    expect(
      isChallengeResponse({
        status: 403,
        headers: { server: "nginx" },
        body: CHALLENGE_BODY,
      }),
    ).toBe(false);
  });

  it("only scans the head of the body", () => {
    const buried = `${"x".repeat(8000)}just a moment`;

    expect(
      isChallengeResponse({
        status: 403,
        headers: { server: "cloudflare" },
        body: buried,
      }),
    ).toBe(false);
  });
});

describe("brokeredFetch challenge handling", () => {
  it("requires a separate cookie grant and keeps it scoped to approved HTTPS hosts", async () => {
    const calls: Record<string, string>[] = [];
    const transport: GuardedTransport = {
      request: async (input) => {
        calls.push(input.headers);
        return { status: 200, headers: {}, body: "ok" };
      },
    };
    expect(
      grantCoversRequest(
        { ...grant, granted: ["network", "network:session"] },
        ["network", "network:cookies"],
        grant.allowedHosts,
      ),
    ).toBe(false);
    const cookieGrant: PermissionGrant = {
      ...grant,
      granted: ["network", "network:cookies"],
    };
    const fetch = createBrokeredFetch(cookieGrant, transport)!;
    await fetch({
      url: "https://example.com/gate.php",
      headers: {
        Cookie: "key=public-selector",
        Authorization: "not-granted",
        Host: "elsewhere.example",
      },
    });
    expect(calls).toEqual([{ cookie: "key=public-selector" }]);
    await expect(
      fetch({
        url: "https://unapproved.example/gate.php",
        headers: { Cookie: "key=public-selector" },
      }),
    ).rejects.toThrow(/hosts you allowed/);
    await expect(
      fetch({
        url: "http://example.com/gate.php",
        headers: { Cookie: "key=public-selector" },
      }),
    ).rejects.toThrow(/https/);
    await expect(
      fetch({
        url: "https://example.com/gate.php",
        headers: { Cookie: "key=value\r\nHost: evil" },
      }),
    ).rejects.toThrow(/header value/);
    cookieGrant.granted = ["network"];
    await fetch({
      url: "https://example.com/gate.php",
      headers: { Cookie: "key=public-selector" },
    });
    expect(calls[1]).toEqual({});
  });
  it("keeps session headers opt-in and never forwards Cookie or Host", async () => {
    const calls: Record<string, string>[] = [];
    const transport: GuardedTransport = {
      request: async (input) => {
        calls.push(input.headers);
        return { status: 200, headers: {}, body: "ok" };
      },
    };
    const request = {
      url: "https://example.com/a",
      headers: {
        Authorization: "Bearer extension-guest",
        Referer: "https://example.com/title",
        Cookie: "browser-secret",
        Host: "elsewhere.example",
      },
    };
    await createBrokeredFetch(grant, transport)!(request);
    expect(calls[0]).toEqual({});
    await createBrokeredFetch(
      { ...grant, granted: ["network", "network:session"] },
      transport,
    )!(request);
    expect(calls[1]).toEqual({
      authorization: "Bearer extension-guest",
      referer: "https://example.com/title",
    });
  });
  it("rejects session header injection, disabled restrictions and hosts outside the grant", async () => {
    const fetcher = createBrokeredFetch(
      { ...grant, granted: ["network", "network:session"] },
      transportReturning({ status: 200, headers: {}, body: "ok" }),
    )!;
    await expect(
      fetcher({
        url: "https://example.com/",
        headers: { Authorization: "Bearer token\r\nInjected: value" },
      }),
    ).rejects.toThrow(/header/);
    await expect(
      fetcher({
        url: "https://example.com/",
        headers: { "X-Vip-Restrict": "0" },
      }),
    ).rejects.toThrow(/restriction/);
    await expect(
      fetcher({
        url: "https://other.example/",
        headers: { Authorization: "Bearer extension-guest" },
      }),
    ).rejects.toThrow(/hosts/);
  });
  it("throws rather than returning a challenge body", async () => {
    const fetcher = createBrokeredFetch(
      grant,
      transportReturning({
        status: 403,
        headers: { server: "cloudflare" },
        body: CHALLENGE_BODY,
      }),
    );

    await expect(
      fetcher?.({ url: "https://example.com/a" }),
    ).rejects.toBeInstanceOf(SourceChallengedError);
  });

  it("names the host so the user knows which site refused", async () => {
    const fetcher = createBrokeredFetch(
      grant,
      transportReturning({
        status: 403,
        headers: { "cf-mitigated": "challenge" },
        body: "",
      }),
    );

    await expect(fetcher?.({ url: "https://example.com/a" })).rejects.toThrow(
      /example\.com/,
    );
  });

  it("passes an ordinary response through untouched", async () => {
    const fetcher = createBrokeredFetch(
      grant,
      transportReturning({ status: 200, headers: {}, body: "ok" }),
    );

    await expect(
      fetcher?.({ url: "https://example.com/a" }),
    ).resolves.toMatchObject({
      status: 200,
      body: "ok",
    });
  });

  it("keeps a refusal by Vestra distinct from a refusal by the site", async () => {
    const fetcher = createBrokeredFetch(
      grant,
      transportReturning({ status: 200, headers: {}, body: "ok" }),
    );

    // Different class, because one is a permission the user can change and the
    // other is a site that does not want automated access.
    await expect(
      fetcher?.({ url: "https://blocked.example/a" }),
    ).rejects.toBeInstanceOf(NetworkDeniedError);
  });

  it("accepts noCloudflareBypass and behaves identically", async () => {
    // Inert by construction: Vestra never bypasses, so the opt-out is already
    // satisfied however it is set.
    const fetcher = createBrokeredFetch(
      grant,
      transportReturning({ status: 200, headers: {}, body: "ok" }),
    );

    const withFlag = await fetcher?.({
      url: "https://example.com/a",
      noCloudflareBypass: true,
    });
    const without = await fetcher?.({ url: "https://example.com/a" });

    expect(withFlag).toEqual(without);
  });
});
