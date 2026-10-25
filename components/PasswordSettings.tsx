"use client";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { authRequest, type AccountInfo } from "./auth-api";

export default function PasswordSettings({
  account,
  onChanged,
}: {
  account: AccountInfo | null;
  onChanged?: () => Promise<void> | void;
}) {
  const [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [show, setShow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  if (!account?.hasPassword) return null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await authRequest("/api/auth/change-password", {
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      setCurrent("");
      setNext("");
      setShow(false);
      setMessage(
        "Heslo je zmenené. Ostatné zariadenia sa musia prihlásiť novým heslom.",
      );
      await onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Heslo sa nepodarilo zmeniť.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel password-settings">
      <p className="eyebrow">TVOJ ÚČET</p>
      <h2>
        <KeyRound size={22} aria-hidden="true" /> Prihlásenie a heslo
      </h2>
      <p>
        Prihlasovacie meno: <strong>{account.username}</strong>
      </p>
      <p className="small muted">
        Týmto menom sa prihlasuješ. Prezývku zobrazenú skupine môžeš meniť
        samostatne v profile.
      </p>
      <form className="stack" onSubmit={submit}>
        <input
          type="hidden"
          name="username"
          autoComplete="username"
          value={account.username || ""}
        />
        <label className="field">
          Súčasné heslo
          <input
            type={show ? "text" : "password"}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            maxLength={128}
            required
            disabled={busy}
          />
        </label>
        <label className="field">
          Nové heslo
          <input
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            minLength={10}
            maxLength={128}
            aria-describedby="change-password-help"
            required
            disabled={busy}
          />
          <small id="change-password-help">
            Aspoň 10 znakov. Môže to byť aj zapamätateľná veta.
          </small>
        </label>
        <button
          type="button"
          className="text-button"
          aria-pressed={show}
          onClick={() => setShow(!show)}
          disabled={busy}
        >
          {show ? <EyeOff size={17} /> : <Eye size={17} />}
          {show ? "Skryť heslá" : "Zobraziť heslá"}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="info-note" role="status">
            {message}
          </p>
        )}
        <button className="button secondary" disabled={busy}>
          {busy ? "Mením heslo…" : "Zmeniť heslo"}
        </button>
      </form>
    </section>
  );
}
