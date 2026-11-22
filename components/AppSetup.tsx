"use client";
import { useEffect, useState } from "react";
import { Share, Smartphone, X } from "lucide-react";
import type { AppState } from "../lib/types";
import { Modal } from "./ui";
import PushSettings from "./PushSettings";
import {
  canPromptInstall,
  isIos,
  isStandalone,
  onInstallChange,
  promptInstall,
} from "./install";

function useInstallState() {
  const [, setTick] = useState(0);
  useEffect(() => onInstallChange(() => setTick((t) => t + 1)), []);
  return {
    installed: isStandalone(),
    canPrompt: canPromptInstall(),
    ios: isIos(),
  };
}

/** Install the app and enable notifications, one button each. */
export default function AppSetup({ state }: { state: AppState }) {
  const { installed, canPrompt, ios } = useInstallState();
  const [help, setHelp] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <section
      className="cz-block cz-setup"
      id="appka"
      aria-label="Appka na telefóne"
    >
      <div className="cz-setup-row">
        <span>
          <strong>Appka na ploche</strong>
          <small>
            {installed
              ? "Otvorená ako appka"
              : message || "Ikona na ploche, otvorí sa ako appka"}
          </small>
        </span>
        {installed ? (
          <span className="cz-setup-ok" aria-hidden="true">
            ✓
          </span>
        ) : canPrompt ? (
          <button
            type="button"
            className="button primary cz-setup-button"
            onClick={async () => {
              const accepted = await promptInstall();
              setMessage(
                accepted
                  ? "Pridané. Appku otvor z ikony na ploche."
                  : "Inštalácia bola zrušená. Môžeš ju skúsiť znova neskôr.",
              );
            }}
          >
            Nainštalovať
          </button>
        ) : (
          <button
            type="button"
            className="button secondary cz-setup-button"
            onClick={() => setHelp(true)}
          >
            Ako na to
          </button>
        )}
      </div>
      <PushSettings
        compact
        configured={state.pushConfigured}
        publicKey={state.vapidPublicKey}
      />
      {help && (
        <Modal title="Appka na plochu" onClose={() => setHelp(false)}>
          {ios ? (
            <ol className="cz-steps">
              <li>
                Otvor túto stránku v <strong>Safari</strong>.
              </li>
              <li>
                Klepni na <Share size={16} aria-label="Zdieľať" />{" "}
                <strong>Zdieľať</strong> dole na lište.
              </li>
              <li>
                Vyber <strong>Pridať na plochu</strong> a potvrď{" "}
                <strong>Pridať</strong>.
              </li>
              <li>
                Appku otvor z novej ikony a tu stlač{" "}
                <strong>Zapnúť upozornenia</strong>. Na iPhone fungujú iba v
                appke z plochy (iOS 16.4 a novší).
              </li>
            </ol>
          ) : (
            <ol className="cz-steps">
              <li>
                Otvor ponuku prehliadača (tri bodky vpravo hore v Chrome).
              </li>
              <li>
                Vyber <strong>Inštalovať aplikáciu</strong> alebo{" "}
                <strong>Pridať na plochu</strong>.
              </li>
              <li>
                Appku otvor z novej ikony{" "}
                <Smartphone size={16} aria-hidden="true" />.
              </li>
            </ol>
          )}
        </Modal>
      )}
    </section>
  );
}

/** Small reminder on Spolu until the device is set up or the person hides it. */
export function SetupReminder({
  state,
  onOpen,
}: {
  state: AppState;
  onOpen: () => void;
}) {
  const key = `cz-setup-hidden-${state.course.id}-${state.me.id}`;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  const needed =
    typeof window !== "undefined" &&
    (!isStandalone() ||
      ("Notification" in window && Notification.permission === "default"));
  if (hidden || !needed) return null;
  return (
    <div className="cz-reminder">
      <button type="button" className="cz-reminder-main" onClick={onOpen}>
        <Smartphone size={18} aria-hidden="true" />
        <span>
          <strong>Appka na plochu a upozornenia</strong>
          <small>Nastavíš jedným klepnutím v Ja</small>
        </span>
      </button>
      <button
        type="button"
        className="cz-reminder-close"
        aria-label="Skryť pripomienku"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(key, "1");
          } catch {
            /* Stays hidden for this visit. */
          }
        }}
      >
        <X size={18} />
      </button>
    </div>
  );
}
