import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const scratch = await mkdtemp(join(tmpdir(), "vestra-anilist-login-"));
try {
  await build({
    entryPoints: [resolve("apps/nova/electron/anilist-login.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: join(scratch, "login.cjs"),
  });
  const {
    AniListBrowserLogin,
    isAniListCallback,
    ANILIST_CLIENT_ID,
    ANILIST_LOGIN_REDIRECT,
  } = createRequire(import.meta.url)(join(scratch, "login.cjs"));
  let now = 1770000000000,
    opened = [],
    connected = [],
    snapshots = [],
    aborted = 0;
  let openFailure = false,
    connectFailure = false,
    finish;
  const secret = "fixture.private.access.token";
  const login = new AniListBrowserLogin({
    now: () => now,
    openBrowser: async (url) => {
      if (openFailure) throw Error(secret);
      opened.push(new URL(url));
    },
    connect: async (token) => {
      if (connectFailure) throw Error(secret);
      connected.push(token);
      if (finish) await finish.promise;
    },
    cancelConnect: async () => {
      aborted++;
    },
    changed: () => snapshots.push(login.snapshot()),
  });
  const state = () => opened.at(-1).searchParams.get("state");
  const callback = (value = state(), extra = {}) =>
    ANILIST_LOGIN_REDIRECT +
    "#" +
    new URLSearchParams({
      state: value,
      access_token: secret,
      token_type: "Bearer",
      ...extra,
    });
  assert.equal(ANILIST_CLIENT_ID, "55841");
  assert.equal(ANILIST_LOGIN_REDIRECT, "vestra://auth/anilist");
  await login.begin();
  assert.equal(opened[0].origin, "https://anilist.co");
  assert.equal(opened[0].pathname, "/api/v2/oauth/authorize");
  assert.equal(opened[0].searchParams.get("client_id"), "55841");
  assert.equal(
    opened[0].searchParams.has("redirect_uri"),
    false,
    "AniList implicit grant must use the registered redirect, without a redirect_uri override",
  );
  assert.deepEqual([...opened[0].searchParams.keys()].sort(), [
    "client_id",
    "response_type",
    "state",
  ]);
  assert.equal(opened[0].searchParams.get("response_type"), "token");
  assert.ok(state().length >= 43);
  assert.equal(login.snapshot().phase, "waiting");
  await login.begin();
  assert.equal(opened.length, 1, "Repeated clicks reuse the pending sign-in");
  assert.equal(await login.complete(callback("forged")), false);
  assert.equal(login.snapshot().phase, "waiting");
  for (const raw of [
    "https://auth/anilist",
    "vestra://other/anilist",
    "vestra://auth/other",
    "vestra://user:pass@auth/anilist",
    "vestra://auth:123/anilist",
    "not a URL",
  ])
    assert.equal(isAniListCallback(raw), false);
  assert.equal(
    await login.complete("vestra://auth/anilist#access_token=" + secret),
    false,
  );
  assert.equal(await login.complete(callback() + "&state=duplicate"), false);
  assert.equal(connected.length, 0);
  const accepted = callback();
  assert.equal(await login.complete(accepted), true);
  assert.deepEqual(connected, [secret]);
  assert.equal(login.snapshot().phase, "idle");
  assert.equal(await login.complete(accepted), false);
  assert.equal(connected.length, 1);
  assert.ok(!JSON.stringify(snapshots).includes(secret));
  await login.begin();
  const canceled = callback();
  await login.cancel();
  assert.equal(await login.complete(canceled), false);
  assert.equal(login.snapshot().phase, "idle");
  await login.begin();
  assert.notEqual(
    state(),
    new URL(canceled).hash.split("state=")[1]?.split("&")[0],
  );
  const expired = callback();
  now += 5 * 60000 + 1;
  assert.equal(login.snapshot().phase, "error");
  assert.equal(await login.complete(expired), false);
  await login.begin();
  await login.complete(
    ANILIST_LOGIN_REDIRECT +
      "#" +
      new URLSearchParams({
        state: state(),
        error: "access_denied",
        error_description: secret,
      }),
  );
  assert.equal(login.snapshot().phase, "error");
  assert.match(login.snapshot().message, /canceled/);
  assert.ok(!login.snapshot().message.includes(secret));
  await login.begin();
  const queryToken =
    ANILIST_LOGIN_REDIRECT +
    "?access_token=" +
    secret +
    "#" +
    new URLSearchParams({ state: state(), token_type: "Bearer" });
  assert.equal(await login.complete(queryToken), true);
  assert.match(login.snapshot().message, /invalid/);
  assert.equal(connected.length, 1);
  connectFailure = true;
  await login.begin();
  await login.complete(callback());
  assert.equal(login.snapshot().phase, "error");
  assert.ok(!login.snapshot().message.includes(secret));
  connectFailure = false;
  openFailure = true;
  await login.begin();
  assert.equal(login.snapshot().phase, "error");
  assert.match(login.snapshot().message, /browser/);
  openFailure = false;
  finish = {};
  finish.promise = new Promise((resolve) => {
    finish.resolve = resolve;
  });
  await login.begin();
  const completing = login.complete(callback());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(login.snapshot().phase, "connecting");
  await login.cancel();
  assert.equal(aborted, 1);
  finish.resolve();
  await completing;
  assert.equal(login.snapshot().phase, "idle");
  const invalid = new AniListBrowserLogin({
    clientId: "invalid",
    openBrowser: async () => {
      throw Error("should not open");
    },
    connect: async () => {},
    cancelConnect: async () => {},
    changed: () => {},
  });
  await assert.rejects(invalid.begin(), /unavailable/);
  const manifest = JSON.parse(
    await readFile(resolve("apps/nova/package.json"), "utf8"),
  );
  assert.ok(manifest.build.protocols.some((p) => p.schemes.includes("vestra")));
  console.log(
    "PASS AniList browser login, registered redirect/client identity, unpredictable single-use state, callback validation, replay/expiry rejection, cancellation, safe errors and installer protocol registration",
  );
} finally {
  await rm(scratch, { recursive: true, force: true });
}
