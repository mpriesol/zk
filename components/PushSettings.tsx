"use client";
import { useEffect, useState } from "react";
import { appPath } from "../lib/paths";

type API = (action: string, data?: Record<string, unknown>) => Promise<unknown>;
async function request(action: string, data: Record<string, unknown> = {}) {
  const response = await fetch(appPath("/api/action"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...data }),
    cache: "no-store",
  });
  const result = (await response.json()) as {
    error?: string;
    subscribed?: boolean;
    [key: string]: unknown;
  };
  if (!response.ok)
    throw new Error(result.error || "Nastavenie sa nepodarilo uložiť.");
  return result;
}
function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
/** Call before sign-out; no subscription identifiers are retained in browser storage. */
export async function disconnectPush(api: API = request) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(
    appPath("/"),
  );
  const subscription = await registration?.pushManager?.getSubscription();
  if (subscription) {
    // Stop the device first even when a network failure prevents server cleanup.
    await subscription.unsubscribe();
    await api("pushUnsubscribe", { endpoint: subscription.endpoint });
  }
  const notifications = await registration?.getNotifications();
  notifications?.forEach((item) => item.close());
  registration?.active?.postMessage({ type: "clear-notifications" });
}

export default function PushSettings({
  publicKey,
  configured,
  api = request,
}: {
  publicKey: string | null;
  configured: boolean;
  api?: API;
}) {
  const [registration, setRegistration] =
    useState<ServiceWorkerRegistration | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [hasSubscription, setHasSubscription] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [supported, setSupported] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let disposed = false;
    const ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setNeedsInstall(ios && !standalone);
    const canPush =
      window.isSecureContext &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(canPush);
    if (!canPush) {
      setChecking(false);
      return;
    }
    setPermission(Notification.permission);
    const changed = () => {
      setEnabled(false);
      setHasSubscription(false);
      setNotice("Odber zariadenia sa zmenil. Môžeš ho znova zapnúť.");
    };
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "push-subscription-changed") changed();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register(appPath("/sw.js"), {
          scope: appPath("/"),
          updateViaCache: "none",
        });
        await navigator.serviceWorker.ready;
        const subscription = await reg.pushManager.getSubscription();
        if (disposed) return;
        setRegistration(reg);
        setHasSubscription(!!subscription);
        if (subscription) {
          const status = await request("pushStatus", {
            endpoint: subscription.endpoint,
          });
          if (!disposed) {
            setEnabled(status.subscribed === true);
            if (status.reenrollRequired === true)
              setNotice(
                "Adresa aplikácie sa zmenila. Upozornenia na tomto zariadení treba znova zapnúť.",
              );
          }
        }
      } catch (cause) {
        if (!disposed)
          setError(
            cause instanceof Error
              ? cause.message
              : "Stav upozornení sa nepodarilo overiť.",
          );
      } finally {
        if (!disposed) setChecking(false);
      }
    })();
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, []);

  async function subscribe() {
    setError("");
    setNotice("");
    if (
      !supported ||
      needsInstall ||
      !configured ||
      !publicKey ||
      !registration ||
      busy
    )
      return;
    if (Notification.permission === "denied") {
      setPermission("denied");
      return;
    }
    setBusy(true);
    let created: PushSubscription | null = null;
    try {
      // Called immediately from this deliberate click, before any network request.
      const granted =
        Notification.permission === "granted"
          ? "granted"
          : await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") {
        setNotice(
          "Upozornenia zostali vypnuté. Správy nájdeš aj naďalej v aplikácii.",
        );
        return;
      }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(publicKey),
        });
        created = subscription;
      }
      await api("pushSubscribe", { subscription: subscription.toJSON() });
      setHasSubscription(true);
      setEnabled(true);
      setNotice("Toto zariadenie je prihlásené na upozornenia organizátora.");
    } catch (cause) {
      if (created) await created.unsubscribe().catch(() => false);
      setEnabled(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "Odber sa nepodarilo zapnúť. Skús to znova.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function unsubscribe() {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await disconnectPush(api);
      setEnabled(false);
      setHasSubscription(false);
      setNotice(
        "Upozornenia na tomto zariadení sú vypnuté. Správy zostávajú v aplikácii.",
      );
    } catch (cause) {
      setEnabled(false);
      setHasSubscription(false);
      setError(
        `Zariadenie bolo odhlásené, ale zmenu na serveri sa nepodarilo potvrdiť. ${cause instanceof Error ? cause.message : ""}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="push-settings" aria-labelledby="push-heading">
      <h3 id="push-heading">Upozornenia od organizátora</h3>
      <p>
        Dobrovoľné upozornenia na tomto zariadení. Žiadne pripomienky
        neaktivity. Všetky správy ostávajú dostupné aj pod zvončekom.
      </p>
      {checking ? (
        <p role="status">Overujem podporu zariadenia…</p>
      ) : (
        <>
          {needsInstall && (
            <p>
              Na iPhone alebo iPade pridaj aplikáciu na plochu: v menu zdieľania
              vyber <strong>Pridať na plochu</strong>. Potom ju otvor z novej
              ikony. Web push vyžaduje iOS/iPadOS 16.4 alebo novší.
            </p>
          )}
          {!supported && !needsInstall && (
            <p>
              Tento prehliadač nepodporuje webové upozornenia alebo stránka nie
              je otvorená cez zabezpečené HTTPS. Správy v aplikácii fungujú.
            </p>
          )}
          {!configured && (
            <p>
              Odosielanie upozornení ešte nie je nastavené. Organizátor musí
              najprv doplniť serverové kľúče.
            </p>
          )}
          {permission === "denied" && (
            <p>
              Upozornenia si v prehliadači zablokoval. Ak zmeníš názor, povoľ
              ich v nastaveniach tejto stránky; ďalšie systémové otázky ti
              nezobrazíme.
            </p>
          )}
          {enabled && (
            <p>
              <strong>Zapnuté pre toto zariadenie.</strong> Prijatie
              poskytovateľom neznamená garantované doručenie ani prečítanie.
            </p>
          )}
          {supported &&
            !needsInstall &&
            configured &&
            permission !== "denied" &&
            !enabled && (
              <button
                type="button"
                onClick={subscribe}
                disabled={busy || !registration}
              >
                {busy ? "Zapínam…" : "Zapnúť upozornenia"}
              </button>
            )}
          {(enabled || hasSubscription) && (
            <button
              type="button"
              className="button-secondary"
              onClick={unsubscribe}
              disabled={busy}
            >
              {busy ? "Vypínam…" : "Vypnúť na tomto zariadení"}
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>Ako pridať aplikáciu na plochu</summary>
        <p>
          Android: v menu Chrome alebo Edge vyber Inštalovať aplikáciu alebo
          Pridať na plochu. iPhone/iPad: Zdieľať → Pridať na plochu. Inštalácia
          sama upozornenia nezapne. Zapisovanie vyžaduje internet; pri výpadku
          ostane rozpracovaný formulár otvorený.
        </p>
      </details>
    </section>
  );
}
