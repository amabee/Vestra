import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { shell } from "electron";

const fixture = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  lookup: vi.fn(),
  fetch: vi.fn(),
  agentOptions: null as any,
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Function) =>
      fixture.handlers.set(channel, handler),
  },
  shell: { openExternal: vi.fn(async () => undefined) },
}));
vi.mock("node:dns/promises", () => ({ lookup: fixture.lookup }));
vi.mock("undici", () => ({
  Agent: class {
    constructor(options: unknown) {
      fixture.agentOptions = options;
    }
  },
  fetch: fixture.fetch,
}));
import { handleIpc, isTrustedDocument, secureWindow } from "./ipc-security";
import { publicLookup } from "./public-network";
import { safeFetch, safeFetchBytes } from "./safe-fetch";

function windowFixture() {
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    mainFrame: { url: "file:///app/index.html" },
    session: {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    },
    setWindowOpenHandler: vi.fn(),
  });
  const window = { webContents: contents } as unknown as BrowserWindow;
  const event = {
    sender: contents,
    senderFrame: contents.mainFrame,
  } as unknown as IpcMainInvokeEvent;
  return { contents, window, event };
}

describe("IPC caller authorization", () => {
  it("keeps ordinary external links working while denying local schemes and credential-bearing URLs", () => {
    vi.mocked(shell.openExternal).mockClear();
    const { window, contents } = windowFixture();
    secureWindow(window, "main", "file:///app/index.html");
    const event = { preventDefault: vi.fn() };
    contents.emit("will-navigate", event, "https://anilist.co/user/example");
    expect(shell.openExternal).toHaveBeenCalledWith(
      "https://anilist.co/user/example",
    );
    for (const url of [
      "file:///private/file",
      "javascript:alert(1)",
      "https://user:password@example.com/",
    ])
      contents.emit("will-navigate", event, url);
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(4);
  });
  it("accepts only the registered top-level trusted document, before invoking privileged code", () => {
    const main = windowFixture(),
      rogue = windowFixture(),
      called = vi.fn();
    secureWindow(main.window, "main", "file:///app/index.html");
    handleIpc("anilist-account:disconnect", called);
    const invoke = fixture.handlers.get("anilist-account:disconnect")!;
    invoke(main.event);
    expect(called).toHaveBeenCalledTimes(1);
    expect(() => invoke(rogue.event)).toThrow(/not permitted/);
    expect(() =>
      invoke({ ...main.event, senderFrame: { url: "file:///app/index.html" } }),
    ).toThrow(/not permitted/);
    expect(() => invoke({ ...main.event, senderFrame: null })).toThrow(
      /not permitted/,
    );
    main.contents.mainFrame.url = "https://hostile.example/";
    expect(() => invoke(main.event)).toThrow(/not permitted/);
    expect(called).toHaveBeenCalledTimes(1);
  });
  it("denies account, source, settings-write and process-opening operations in the player", () => {
    const player = windowFixture();
    secureWindow(player.window, "player", "file:///app/index.html");
    for (const channel of [
      "mpv:pause",
      "settings:get",
      "player:set-quality",
      "mpv:set-subtitle-font",
    ]) {
      handleIpc(channel, () => "allowed");
      expect(fixture.handlers.get(channel)!(player.event)).toBe("allowed");
    }
    for (const channel of [
      "anilist-account:status",
      "sources:install",
      "settings:patch",
      "mpv:open",
      "shell:open-external",
      "updates:install",
    ]) {
      handleIpc(channel, () => "unsafe");
      expect(() => fixture.handlers.get(channel)!(player.event)).toThrow(
        /not permitted/,
      );
    }
  });
  it("matches complete documents instead of origin prefixes", () => {
    for (const url of [
      "http://localhost:52730/",
      "http://localhost:5273.evil/",
      "http://user@localhost:5273/",
      "http://localhost:5273/other",
      "http://localhost:5273/?x=1",
      "about:blank",
    ])
      expect(isTrustedDocument(url, "http://localhost:5273/")).toBe(false);
    expect(
      isTrustedDocument(
        "http://localhost:5273/#/anime",
        "http://localhost:5273/",
      ),
    ).toBe(true);
  });
  it("blocks navigation, redirects, webviews and browser permissions", () => {
    const { window, contents } = windowFixture();
    secureWindow(window, "player", "file:///app/index.html");
    const event = { preventDefault: vi.fn() };
    contents.emit("will-navigate", event, "https://hostile.example");
    contents.emit("will-redirect", event);
    contents.emit("will-attach-webview", event);
    expect(event.preventDefault).toHaveBeenCalledTimes(3);
    expect(
      contents.setWindowOpenHandler.mock.calls[0]![0]({
        url: "https://example.com",
      }),
    ).toEqual({ action: "deny" });
    const callback = vi.fn();
    contents.session.setPermissionRequestHandler.mock.calls[0]![0](
      contents,
      "media",
      callback,
    );
    expect(callback).toHaveBeenCalledWith(false);
    expect(contents.session.setPermissionCheckHandler.mock.calls[0]![0]()).toBe(
      false,
    );
  });
});

describe("connection-time DNS validation and bounded responses", () => {
  beforeEach(() => {
    fixture.lookup
      .mockReset()
      .mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
    fixture.fetch.mockReset();
  });
  const resolve = (all = false) =>
    new Promise<any>((accept, reject) =>
      publicLookup("source.example", { all }, ((
        error: Error | null,
        address: unknown,
        family: number,
      ) => (error ? reject(error) : accept({ address, family }))) as any),
    );
  it("returns the checked IP to the socket with a single lookup", async () => {
    expect(await resolve()).toEqual({ address: "8.8.8.8", family: 4 });
    expect(fixture.lookup).toHaveBeenCalledTimes(1);
    expect(fixture.agentOptions.connect.lookup).toBe(publicLookup);
  });
  it("rejects DNS rebinding at the actual connection after a public precheck", async () => {
    fixture.lookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    fixture.fetch.mockImplementation(async () => {
      await resolve();
      throw Error("must not connect");
    });
    await expect(
      safeFetch({ url: "https://source.example", timeoutMs: 100 }),
    ).rejects.toThrow();
    expect(fixture.lookup).toHaveBeenCalledTimes(2);
  });
  it("rejects mixed public/private records and IPv4-mapped IPv6", async () => {
    for (const address of [
      "10.0.0.1",
      "169.254.169.254",
      "::ffff:7f00:1",
      "0:0:0:0:0:ffff:c0a8:101",
    ]) {
      fixture.lookup.mockResolvedValue([
        { address: "8.8.8.8", family: 4 },
        { address, family: address.includes(":") ? 6 : 4 },
      ]);
      await expect(resolve(true)).rejects.toThrow(/not a public/);
    }
  });
  it("uses the pinned dispatcher and keeps redirects and credentials disabled", async () => {
    fixture.fetch.mockResolvedValue(new Response("ok"));
    expect((await safeFetch({ url: "https://source.example" })).body).toBe(
      "ok",
    );
    expect(fixture.fetch.mock.calls[0]![1]).toMatchObject({
      dispatcher: expect.anything(),
      redirect: "error",
      credentials: "omit",
    });
    await expect(
      safeFetch({ url: "https://user:secret@source.example" }),
    ).rejects.toThrow(/Credentials/);
    await expect(safeFetch({ url: "https://127.0.0.1" })).rejects.toThrow(
      /not a public/,
    );
  });
  it("rejects a normalized hexadecimal loopback URL before transport", async () => {
    await expect(
      safeFetch({ url: "https://[::ffff:7f00:1]/" }),
    ).rejects.toThrow(/not a public/);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("follows only declared hosts, rechecks DNS and drops cookies and authorization across origins", async () => {
    fixture.fetch
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/same" } }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/video" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok"));
    const response = await safeFetch({
      url: "https://source.example/start",
      allowedRedirectHosts: ["source.example", "cdn.example"],
      headers: {
        Cookie: "key=public",
        Authorization: "Bearer source",
        Referer: "https://source.example/",
      },
    });
    expect(response.body).toBe("ok");
    expect(response.url).toBe("https://cdn.example/video");
    expect(fixture.fetch.mock.calls[1]![1].headers).toHaveProperty(
      "Cookie",
      "key=public",
    );
    expect(fixture.fetch.mock.calls[2]![1].headers).toEqual({
      Referer: "https://source.example/",
    });
    expect(fixture.lookup.mock.calls.map((call) => call[0])).toEqual([
      "source.example",
      "source.example",
      "cdn.example",
    ]);
    for (const [, init] of fixture.fetch.mock.calls)
      expect(init).toMatchObject({
        redirect: "manual",
        dispatcher: expect.anything(),
        credentials: "omit",
      });
  });
  it("rejects unapproved, plaintext, credential-bearing and private redirect destinations before I/O", async () => {
    for (const location of [
      "https://other.example/video",
      "http://cdn.example/video",
      "https://user:secret@cdn.example/video",
      "https://cdn.example:8443/video",
      "https://127.0.0.1/video",
    ]) {
      fixture.fetch
        .mockReset()
        .mockResolvedValueOnce(
          new Response(null, { status: 302, headers: { location } }),
        );
      await expect(
        safeFetch({
          url: "https://source.example/",
          allowedRedirectHosts: ["source.example", "cdn.example", "127.0.0.1"],
        }),
      ).rejects.toThrow(/approved HTTPS|not a public/);
      expect(fixture.fetch).toHaveBeenCalledTimes(1);
    }
    fixture.fetch
      .mockReset()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example/video" },
        }),
      );
    fixture.lookup
      .mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    await expect(
      safeFetch({
        url: "https://source.example/",
        allowedRedirectHosts: ["source.example", "cdn.example"],
      }),
    ).rejects.toThrow(/not a public|resolves to/);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });
  it("bounds redirect loops and applies POST redirect method rules", async () => {
    fixture.fetch.mockImplementation(
      async () =>
        new Response(null, { status: 302, headers: { location: "/again" } }),
    );
    await expect(
      safeFetch({
        url: "https://source.example/",
        allowedRedirectHosts: ["source.example"],
      }),
    ).rejects.toThrow(/redirect limit/);
    expect(fixture.fetch).toHaveBeenCalledTimes(6);
    for (const [status, method, body] of [
      [303, "GET", null],
      [307, "POST", "fixture"],
    ] as const) {
      fixture.fetch
        .mockReset()
        .mockResolvedValueOnce(
          new Response(null, { status, headers: { location: "/target" } }),
        )
        .mockResolvedValueOnce(new Response("ok"));
      await safeFetch({
        url: "https://source.example/",
        method: "POST",
        body: "fixture",
        headers: { "Content-Type": "text/plain" },
        allowedRedirectHosts: ["source.example"],
      });
      expect(fixture.fetch.mock.calls[1]![1]).toMatchObject({ method, body });
      expect(fixture.fetch.mock.calls[1]![1].headers).toEqual(
        status === 303 ? {} : { "Content-Type": "text/plain" },
      );
    }
  });
  it("stops oversized chunked bodies early and counts UTF-8 bytes", async () => {
    let cancelled = false;
    fixture.fetch.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("ééé"));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    await expect(
      safeFetch({ url: "https://source.example", maxBytes: 5 }),
    ).rejects.toThrow(/larger/);
    expect(cancelled).toBe(true);
    await expect(
      safeFetchBytes({ url: "https://source.example", maxBytes: 5 }),
    ).rejects.toThrow(/larger/);
  });
});
