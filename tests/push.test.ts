import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createManifest } from "../scripts/pwa-assets.mjs";
import {
  validateSubscription,
  sendPush,
  classifyPushResponse,
  validNotificationPath,
  sendInvitation,
  notificationPath,
  normalizeApplicationUrl,
} from "../lib/push.ts";

const b64 = (value: ArrayBuffer | Uint8Array) =>
  Buffer.from(
    value instanceof Uint8Array ? value : new Uint8Array(value),
  ).toString("base64url");
async function keys() {
  const subscriber = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const vapid = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", vapid.privateKey);
  return {
    subscription: {
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      expirationTime: null,
      keys: {
        p256dh: b64(await crypto.subtle.exportKey("raw", subscriber.publicKey)),
        auth: b64(crypto.getRandomValues(new Uint8Array(16))),
      },
    },
    config: {
      publicKey: b64(await crypto.subtle.exportKey("raw", vapid.publicKey)),
      privateKey: privateJwk.d!,
      subject: "mailto:organizer@example.test",
    },
  };
}

test("subscription validates real P-256 keys and rejects arbitrary outbound endpoints", async () => {
  const { subscription } = await keys();
  assert.equal(
    validateSubscription(subscription).endpoint,
    subscription.endpoint,
  );
  for (const endpoint of [
    "https://127.0.0.1/push",
    "http://fcm.googleapis.com/a",
    "https://fcm.googleapis.com.attacker.test/a",
    "https://user:pass@fcm.googleapis.com/a",
    "https://fcm.googleapis.com:8443/a",
    "https://fcm.googleapis.com/a#fragment",
    "file:///etc/passwd",
  ]) {
    assert.throws(() => validateSubscription({ ...subscription, endpoint }));
  }
  assert.throws(() =>
    validateSubscription({
      ...subscription,
      keys: { ...subscription.keys, auth: "bad" },
    }),
  );
  for (const endpoint of [
    "https://updates.push.services.mozilla.com/wpush/v2/id",
    "https://web.push.apple.com/Q123",
    "https://wns2-bl2p.notify.windows.com/w/?token=test",
  ]) {
    assert.equal(
      validateSubscription({ ...subscription, endpoint }).endpoint,
      endpoint,
    );
  }
});

test("real encrypted request uses aes128gcm + VAPID and accepted is only provider acceptance", async () => {
  const { subscription, config } = await keys();
  let calls = 0;
  const transport = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    calls++;
    assert.equal(url, subscription.endpoint);
    assert.equal(options?.method?.toLowerCase(), "post");
    assert.equal(options?.redirect, "error");
    const headers = new Headers(options?.headers);
    assert.equal(headers.get("content-encoding"), "aes128gcm");
    assert.match(headers.get("authorization") || "", /^vapid /);
    const bytes = new Uint8Array(options?.body as ArrayBuffer);
    assert.ok(bytes.byteLength >= 200, "payload is encrypted, nonempty binary");
    assert.ok(!new TextDecoder().decode(bytes).includes("secret-message-id"));
    return new Response("", { status: 201 });
  }) as typeof fetch;
  assert.deepEqual(
    await sendPush(
      subscription,
      { messageId: "secret-message-id" },
      config,
      transport,
    ),
    { status: "accepted", httpStatus: 201 },
  );
  assert.equal(calls, 1);
});

test("expired subscriptions are removed, invalid configuration and subscriptions never call provider", async () => {
  const { subscription, config } = await keys();
  let calls = 0;
  const transport = (async () => {
    calls++;
    return new Response(null, { status: 410 });
  }) as typeof fetch;
  assert.equal(
    (await sendPush(subscription, { messageId: "x" }, config, transport))
      .status,
    "expired",
  );
  assert.equal(
    (
      await sendPush(
        { ...subscription, expirationTime: 1 },
        { messageId: "x" },
        config,
        transport,
      )
    ).status,
    "expired",
  );
  assert.equal(
    (
      await sendPush(
        { ...subscription, endpoint: "https://localhost/a" },
        { messageId: "x" },
        config,
        transport,
      )
    ).status,
    "failed",
  );
  assert.equal(
    (
      await sendPush(
        subscription,
        { messageId: "x" },
        { ...config, privateKey: "" },
        transport,
      )
    ).status,
    "failed",
  );
  assert.equal(calls, 1);
});

test("rate limits/transient failures retry but bad auth does not", async () => {
  assert.deepEqual(
    classifyPushResponse(
      new Response(null, { status: 429, headers: { "retry-after": "120" } }),
    ),
    {
      status: "retry",
      httpStatus: 429,
      retryAfterSeconds: 120,
      reason: "Poskytovateľ dočasne neprijal upozornenie.",
    },
  );
  assert.equal(
    classifyPushResponse(new Response(null, { status: 503 })).status,
    "retry",
  );
  assert.equal(
    classifyPushResponse(new Response(null, { status: 403 })).status,
    "failed",
  );
  const { subscription, config } = await keys();
  const result = await sendPush(
    subscription,
    { messageId: "x" },
    config,
    (async () => {
      throw new Error("network down");
    }) as typeof fetch,
  );
  assert.equal(result.status, "retry");
});

test("notification link validation confines clicks to the app", () => {
  assert.equal(
    validNotificationPath("/priprava/?view=messages&message=123", "/priprava"),
    "/priprava/?view=messages&message=123",
  );
  for (const path of [
    "//evil.test",
    "https://evil.test",
    "/\\evil.test/a",
    "/signout-with-chatgpt",
    "/callback",
    "/?view=messages&message=outside",
    "/zk/?view=messages",
    "/priprava-other/",
    "/priprava/../",
    "/priprava/%2e%2e/",
    "/priprava/api/auth/sign-out",
    "/priprava/%2f..%2fadmin",
  ])
    assert.equal(
      validNotificationPath(path, "/priprava"),
      "/priprava/?view=messages",
    );
});

test("service worker displays generic fallback, same-origin navigation, no private caching", async () => {
  const handlers: Record<string, (event: any) => void> = {};
  const notices: any[] = [];
  const opened: string[] = [];
  const context = vm.createContext({
    URL,
    self: {
      location: { origin: "https://app.example.test" },
      addEventListener: (name: string, callback: (event: any) => void) => {
        handlers[name] = callback;
      },
      registration: {
        scope: "https://app.example.test/priprava/",
        showNotification: async (title: string, options: any) =>
          notices.push({ title, ...options }),
      },
      clients: {
        matchAll: async () => [],
        openWindow: async (path: string) => opened.push(path),
      },
    },
  });
  vm.runInContext(
    await readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    context,
  );
  assert.equal(handlers.fetch, undefined, "does not cache pages or API data");
  let pending: Promise<unknown> = Promise.resolve();
  handlers.push({
    data: { json: () => ({ url: "https://evil.test/a" }) },
    waitUntil: (p: Promise<unknown>) => {
      pending = p;
    },
  });
  await pending;
  assert.equal(notices[0].title, "Cestou Zimy");
  assert.equal(notices[0].data.url, "/priprava/?view=messages");
  handlers.notificationclick({
    notification: {
      data: { url: "/priprava/?view=messages&message=abc" },
      close() {},
    },
    waitUntil: (p: Promise<unknown>) => {
      pending = p;
    },
  });
  await pending;
  assert.deepEqual(opened, ["/priprava/?view=messages&message=abc"]);
});

test("invitation uses server token, text body and provider idempotency key", async () => {
  let calls = 0;
  const result = await sendInvitation(
    "member@example.test",
    "Miro",
    "Testovací kurz",
    "invite-123",
    {
      apiKey: "test-secret",
      from: "Cestou Zimy <noreply@example.test>",
      siteUrl: "https://app.example.test/priprava",
    },
    (async (url, options) => {
      calls++;
      assert.equal(url, "https://api.resend.com/emails");
      const headers = new Headers(options?.headers);
      assert.equal(headers.get("idempotency-key"), "invite-123");
      assert.equal(headers.get("authorization"), "Bearer test-secret");
      const body = JSON.parse(options?.body as string);
      assert.ok(body.text.includes("https://app.example.test/priprava/"));
      assert.equal(body.html, undefined);
      assert.deepEqual(body.to, ["member@example.test"]);
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  );
  assert.equal(result.status, "accepted");
  assert.equal(calls, 1);
});

test("push click stays under canonical /priprava and does not navigate the public homepage or /zk backend", async () => {
  const handlers: Record<string, (event: any) => void> = {};
  const opened: string[] = [];
  const navigated: string[] = [];
  const self = {
    location: { origin: "https://zimnykurz.sk" },
    registration: { scope: "https://zimnykurz.sk/priprava/" },
    addEventListener: (name: string, callback: (event: any) => void) => {
      handlers[name] = callback;
    },
    clients: {
      matchAll: async () => [
        {
          url: "https://zimnykurz.sk/",
          navigate: async (path: string) => navigated.push(path),
          focus: async () => {},
        },
      ],
      openWindow: async (path: string) => opened.push(path),
    },
  };
  vm.runInContext(
    await readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    vm.createContext({ URL, self }),
  );
  let pending: Promise<unknown> = Promise.resolve();
  for (const url of [
    "/zk/?view=messages",
    "/priprava/../",
    "/priprava-other/",
    "/priprava/api/auth/sign-out",
  ]) {
    handlers.notificationclick({
      notification: { data: { url }, close() {} },
      waitUntil: (p: Promise<unknown>) => {
        pending = p;
      },
    });
    await pending;
  }
  assert.deepEqual(opened, Array(4).fill("/priprava/?view=messages"));
  assert.deepEqual(
    navigated,
    [],
    "public website window must remain on the public website",
  );
});

test("install manifest and icons match either deployment stage", () => {
  for (const base of ["/zk", "/priprava"]) {
    const manifest = createManifest(base);
    assert.equal(manifest.id, base + "/");
    assert.equal(manifest.start_url, base + "/");
    assert.equal(manifest.scope, base + "/");
    assert.ok(
      manifest.icons.every((icon: { src: string }) =>
        icon.src.startsWith(base + "/brand/"),
      ),
    );
  }
  assert.throws(() => createManifest("/outside"));
});

test("notification path and application identity follow explicit deployment config", () => {
  assert.equal(
    notificationPath("m 1", "https://hub.biketrek.sk/zk"),
    "/zk/?view=messages&message=m%201",
  );
  assert.equal(
    notificationPath("m 1", "https://zimnykurz.sk/priprava/"),
    "/priprava/?view=messages&message=m%201",
  );
  assert.equal(
    normalizeApplicationUrl("https://hub.biketrek.sk/zk/"),
    "https://hub.biketrek.sk/zk",
  );
  assert.equal(
    normalizeApplicationUrl("https://zimnykurz.sk/priprava"),
    "https://zimnykurz.sk/priprava",
  );
  assert.equal(
    normalizeApplicationUrl("http://localhost:3000/zk"),
    "http://localhost:3000/zk",
  );
  assert.equal(normalizeApplicationUrl("http://example.test/zk"), "");
  assert.equal(
    normalizeApplicationUrl("https://user:pass@zimnykurz.sk/priprava"),
    "",
  );
  assert.equal(
    validNotificationPath("/zk/?view=messages&message=1", "/zk"),
    "/zk/?view=messages&message=1",
  );
  assert.equal(
    validNotificationPath("/priprava/?view=messages&message=1", "/zk"),
    "/zk/?view=messages",
  );
});

test("same worker code scopes /zk deployment notifications and icons from registration", async () => {
  const handlers: Record<string, (event: any) => void> = {};
  const notices: any[] = [];
  const opened: string[] = [];
  const self = {
    location: { origin: "https://hub.biketrek.sk" },
    registration: {
      scope: "https://hub.biketrek.sk/zk/",
      showNotification: async (title: string, value: any) =>
        notices.push({ title, ...value }),
    },
    addEventListener: (name: string, callback: (event: any) => void) => {
      handlers[name] = callback;
    },
    clients: {
      matchAll: async () => [],
      openWindow: async (path: string) => opened.push(path),
    },
  };
  vm.runInContext(
    await readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    vm.createContext({ URL, self }),
  );
  let pending: Promise<unknown> = Promise.resolve();
  handlers.push({
    data: { json: () => ({ url: "/zk/?view=messages&message=x" }) },
    waitUntil: (p: Promise<unknown>) => {
      pending = p;
    },
  });
  await pending;
  assert.equal(notices[0].icon, "/zk/brand/icon-192.png");
  assert.equal(notices[0].data.url, "/zk/?view=messages&message=x");
  handlers.notificationclick({
    notification: {
      data: { url: "/priprava/?view=messages&message=x" },
      close() {},
    },
    waitUntil: (p: Promise<unknown>) => {
      pending = p;
    },
  });
  await pending;
  assert.deepEqual(opened, ["/zk/?view=messages"]);
});
