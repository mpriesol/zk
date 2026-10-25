"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Mail, ShieldCheck } from "lucide-react";
import { appPath } from "../lib/paths";

async function request(path: string, body: Record<string, unknown>) {
  const response = await fetch(appPath("/api/auth/" + path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify(body),
  });
  let data: any;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "Server neodpovedal. Skontroluj pripojenie a skús to znova.",
    );
  }
  if (!response.ok) {
    if (response.status === 429)
      throw new Error("Príliš veľa pokusov. Počkaj minútu a skús to znova.");
    const code = data?.code || data?.error?.code;
    if (
      [
        "INVALID_OTP",
        "OTP_EXPIRED",
        "TOO_MANY_ATTEMPTS",
        "INVALID_TOKEN",
        "OTP_NOT_FOUND",
      ].includes(code)
    )
      throw new Error(
        "Kód je nesprávny, vypršal alebo už bol použitý. Vyžiadaj si nový kód.",
      );
    throw new Error(
      response.status === 503
        ? "E-mail sa nepodarilo odoslať. Skús to neskôr alebo sa ozvi organizátorovi."
        : "Prihlásenie sa nepodarilo. Skontroluj najnovší kód a pozvánku do kurzu.",
    );
  }
  return data;
}
export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState(""),
    [otp, setOtp] = useState(""),
    [step, setStep] = useState<"email" | "code">("email"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [seconds, setSeconds] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);
  async function send() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await request("email-otp/send-verification-otp", {
        email: email.trim().toLowerCase(),
        type: "sign-in",
      });
      setStep("code");
      setOtp("");
      setSeconds(60);
      setMessage(
        "Ak má táto adresa aktívnu pozvánku, poslali sme na ňu kód. Skontroluj aj nevyžiadanú poštu.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Odoslanie sa nepodarilo.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step === "email") return send();
    setBusy(true);
    setError("");
    try {
      await request("sign-in/email-otp", {
        email: email.trim().toLowerCase(),
        otp,
      });
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prihlásenie sa nepodarilo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="access-screen">
      <div className="access-landscape" />
      <div className="access-card">
        <div className="brand-access">
          Cestou Zimy<span>PRÍPRAVA NA ZIMNÝ KURZ</span>
        </div>
        <h1>
          {step === "email"
            ? "Začnime spoločnú cestu."
            : "Pozri sa do svojej schránky."}
        </h1>
        <p>
          {step === "email"
            ? "Tvoj denník pohybu, spoločné výzvy a správy od organizátorov. Prihlás sa e-mailom, na ktorý máš pozvánku."
            : "Zadaj najnovší šesťmiestny kód. Platí 10 minút a môžeš ho použiť iba raz."}
        </p>
        <form className="stack" onSubmit={submit}>
          <label className="field">
            E-mail
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              required
              readOnly={step === "code"}
              disabled={busy}
            />
          </label>
          {step === "code" && (
            <label className="field">
              Prihlasovací kód
              <input
                ref={codeInput}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                placeholder="6 číslic"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                required
                disabled={busy}
              />
            </label>
          )}
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
          <button className="button primary" disabled={busy}>
            {busy
              ? "Chvíľku…"
              : step === "email"
                ? "Poslať prihlasovací kód"
                : "Prihlásiť sa"}{" "}
            {step === "email" ? <Mail size={18} /> : <ArrowRight size={18} />}
          </button>
          {step === "code" && (
            <>
              <button
                type="button"
                className="button secondary"
                disabled={busy || seconds > 0}
                onClick={() => void send()}
              >
                {seconds > 0 ? `Nový kód o ${seconds} s` : "Poslať nový kód"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setStep("email");
                  setOtp("");
                  setError("");
                  setMessage("");
                }}
              >
                Použiť inú adresu
              </button>
            </>
          )}
        </form>
        <p className="small muted">
          <ShieldCheck size={15} aria-hidden="true" /> Prístup majú iba pozvaní
          členovia. Účet zostane prihlásený na tomto zariadení, kým sa
          neodhlásiš alebo nevyprší relácia.
        </p>
      </div>
    </main>
  );
}
