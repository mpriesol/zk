/* No fetch handler and no CacheStorage: private pages/API data are never cached here. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
// A new origin/prefix has its own service worker and must be explicitly subscribed.
const APP_BASE_PATH = new URL(self.registration.scope).pathname.replace(
  /\/+$/,
  "",
);
const FALLBACK_PATH = APP_BASE_PATH + "/?view=messages";
function isAppPath(pathname) {
  return pathname === APP_BASE_PATH || pathname.startsWith(APP_BASE_PATH + "/");
}
function safePath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return FALLBACK_PATH;
  try {
    const url = new URL(value, self.location.origin);
    const relative = url.pathname.slice(APP_BASE_PATH.length);
    if (
      url.origin !== self.location.origin ||
      !isAppPath(url.pathname) ||
      /%(?:2f|5c)/i.test(url.pathname) ||
      /^\/(api|signin-with-chatgpt|signout-with-chatgpt|callback)(\/|$)/.test(
        relative,
      )
    )
      return FALLBACK_PATH;
    return url.pathname + url.search + url.hash;
  } catch {
    return FALLBACK_PATH;
  }
}
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    /* Show generic notice. */
  }
  event.waitUntil(
    self.registration.showNotification(
      typeof payload.title === "string"
        ? payload.title.slice(0, 100)
        : "Cestou Zimy",
      {
        body:
          typeof payload.body === "string"
            ? payload.body.slice(0, 400)
            : "Nová správa od organizátora. Otvor aplikáciu.",
        tag:
          typeof payload.tag === "string"
            ? payload.tag.slice(0, 120)
            : "cestou-zimy-message",
        icon: APP_BASE_PATH + "/brand/icon-192.png",
        badge: APP_BASE_PATH + "/brand/notification-badge.png",
        data: { url: safePath(payload.url) },
        renotify: false,
      },
    ),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      let windows = [];
      try {
        windows = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
      } catch {
        /* A fresh window is the fallback. */
      }
      for (const client of windows) {
        try {
          const current = new URL(client.url);
          if (
            current.origin !== self.location.origin ||
            !isAppPath(current.pathname) ||
            !("focus" in client)
          )
            continue;
          const navigated = await client.navigate(path);
          if (navigated === null) continue;
          const target = navigated || client;
          await target.focus();
          if (target.postMessage)
            target.postMessage({ type: "notification-navigate", url: path });
          return;
        } catch {
          // A failed navigate/focus must not prevent openWindow. The live app
          // also receives the target when it can recover without reloading.
          try {
            if (client.postMessage)
              client.postMessage({ type: "notification-navigate", url: path });
          } catch {
            /* closed client */
          }
        }
      }
      await self.clients.openWindow(path);
    })(),
  );
});
self.addEventListener("pushsubscriptionchange", (event) => {
  // Do not silently enroll an account. User confirms a fresh subscription in settings.
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      clients.forEach((client) =>
        client.postMessage({ type: "push-subscription-changed" }),
      );
    }),
  );
});
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "clear-notifications") {
    event.waitUntil(
      self.registration
        .getNotifications()
        .then((items) => items.forEach((item) => item.close())),
    );
  }
});
