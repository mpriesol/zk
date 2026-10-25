"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Mail,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import {
  authLinkToken,
  authRequest,
  clearAuthLink,
  type AuthOptions,
} from "./auth-api";

type Screen = "login" | "register" | "email" | "code" | "reset";
export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [options, setOptions] = useState<AuthOptions | null>(null),
    [screen, setScreen] = useState<Screen>(() =>
      authLinkToken("reset")
        ? "reset"
        : authLinkToken("invite")
          ? "register"
          : "login",
    ),
    [inviteToken, setInviteToken] = useState(() => authLinkToken("invite")),
    [resetToken, setResetToken] = useState(() => authLinkToken("reset")),
    [username, setUsername] = useState(""),
    [fullName, setFullName] = useState(""),
    [password, setPassword] = useState(""),
    [visiblePassword, setVisiblePassword] = useState(false),
    [email, setEmail] = useState(""),
    [otp, setOtp] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [seconds, setSeconds] = useState(0),
    [forgotHelp, setForgotHelp] = useState(false),
    [configRetry, setConfigRetry] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    setError("");
    authRequest<AuthOptions>("/api/auth-options")
      .then((data) => {
        if (cancelled) return;
        if (
          typeof data.password !== "boolean" ||
          typeof data.emailOtp !== "boolean" ||
          typeof data.registrationOpen !== "boolean"
        )
          throw new Error("Nastavenie prihlásenia sa nepodarilo načítať.");
        setOptions(data);
        setScreen((current) =>
          current === "reset"
            ? current
            : !data.password
              ? "email"
              : current === "register" && !data.registrationOpen
                ? "login"
                : current,
        );
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Nastavenie prihlásenia sa nepodarilo načítať.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [configRetry]);
  useEffect(() => {
    if (screen === "code") codeInput.current?.focus();
  }, [screen]);
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds(seconds - 1), 1000);
    return () => clearTimeout(id);
  }, [seconds]);
  function changeScreen(next: Screen) {
    setScreen(next);
    setError("");
    setMessage("");
    setPassword("");
    setOtp("");
    setVisiblePassword(false);
    setForgotHelp(false);
  }
  async function sendCode() {
    await authRequest("/api/auth/email-otp/send-verification-otp", {
      email: email.trim().toLowerCase(),
      type: "sign-in",
    });
    setScreen("code");
    setOtp("");
    setSeconds(60);
    setMessage(
      "Ak má táto adresa aktívnu pozvánku, poslali sme na ňu kód. Skontroluj aj nevyžiadanú poštu.",
    );
  }
  async function finishLogin() {
    // The authenticated app handles a pending invitation after session creation.
    // An expired invitation must not prevent signing in to an existing account.
    setPassword("");
    setOtp("");
    onSuccess();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!options || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (screen === "email") await sendCode();
      else if (screen === "code") {
        await authRequest("/api/auth/sign-in/email-otp", {
          email: email.trim().toLowerCase(),
          otp,
        });
        await finishLogin();
      } else if (screen === "register") {
        await authRequest("/api/register", {
          username: username.trim(),
          password,
          ...(fullName.trim() ? { name: fullName.trim() } : {}),
          ...(inviteToken ? { inviteToken } : {}),
        });
        clearAuthLink("invite");
        setInviteToken(null);
        setPassword("");
        setFullName("");
        onSuccess();
      } else if (screen === "reset") {
        if (!resetToken)
          throw new Error(
            "Odkaz na obnovu hesla chýba. Vyžiadaj si nový od organizátora.",
          );
        await authRequest("/api/password/reset", {
          token: resetToken,
          newPassword: password,
        });
        clearAuthLink("reset");
        setResetToken(null);
        setPassword("");
        setVisiblePassword(false);
        setScreen(options.password ? "login" : "email");
        setMessage("Heslo je zmenené. Prihlás sa svojím menom a novým heslom.");
      } else {
        await authRequest("/api/auth/sign-in/username", {
          username: username.trim(),
          password,
          rememberMe: true,
        });
        await finishLogin();
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Požiadavku sa nepodarilo dokončiť.",
      );
    } finally {
      setBusy(false);
    }
  }
  const isPassword =
    screen === "login" || screen === "register" || screen === "reset";
  const headings: Record<Screen, string> = {
    login: "Vitaj späť.",
    register: "Vytvor si svoj účet.",
    email: "Prihlásenie e-mailom.",
    code: "Pozri sa do svojej schránky.",
    reset: "Vyber si nové heslo.",
  };
  const introductions: Record<Screen, string> = {
    login: "Tvoj denník pohybu, spoločné výzvy a správy od organizátorov.",
    register:
      "Stačí prezývka a heslo. Meno a priezvisko môžeš doplniť dobrovoľne.",
    email:
      "Použi adresu, na ktorú máš pozvánku do kurzu. Pošleme ti jednorazový kód.",
    code: "Zadaj najnovší šesťmiestny kód. Platí 10 minút a môžeš ho použiť iba raz.",
    reset:
      "Po zmene sa znova prihlásiš. Staré prihlásenia na ostatných zariadeniach sa ukončia.",
  };
  return (
    <main className="access-screen">
      <div className="access-landscape" />
      <div className="access-card">
        <div className="brand-access">
          Cestou Zimy<span>PRÍPRAVA NA ZIMNÝ KURZ</span>
        </div>
        <h1>{headings[screen]}</h1>
        <p>{introductions[screen]}</p>
        {inviteToken && screen !== "reset" && (
          <p className="info-note">
            Prichádzaš cez pozvánku do kurzu. Ak už účet máš, prihlás sa ním.
          </p>
        )}
        {options?.password && screen !== "reset" && (
          <div className="auth-tabs" aria-label="Prihlásenie a registrácia">
            <button
              type="button"
              className={screen === "login" ? "active" : ""}
              aria-pressed={screen === "login"}
              disabled={busy}
              onClick={() => changeScreen("login")}
            >
              Prihlásiť sa
            </button>
            {options.registrationOpen && (
              <button
                type="button"
                className={screen === "register" ? "active" : ""}
                aria-pressed={screen === "register"}
                disabled={busy}
                onClick={() => changeScreen("register")}
              >
                Vytvoriť účet
              </button>
            )}
          </div>
        )}
        <form className="stack" onSubmit={submit}>
          {(screen === "login" || screen === "register") && (
            <label className="field">
              Prihlasovacie meno / prezývka
              <input
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={3}
                maxLength={32}
                required
                disabled={busy || !options}
                aria-describedby={
                  screen === "register"
                    ? "username-help username-privacy"
                    : undefined
                }
              />
              {screen === "register" && (
                <small id="username-help">
                  3–32 znakov. Môžeš použiť aj diakritiku. Týmto menom sa budeš
                  prihlasovať.
                </small>
              )}
            </label>
          )}
          {screen === "register" && (
            <>
              <p className="small muted" id="username-privacy">
                Ostatní účastníci uvidia iba tvoju prezývku.
              </p>
              <label className="field">
                Meno a priezvisko (nepovinné)
                <input
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={100}
                  disabled={busy || !options}
                />
              </label>
            </>
          )}
          {isPassword && (
            <label className="field">
              {screen === "reset" ? "Nové heslo" : "Heslo"}
              <span className="auth-password-input">
                <input
                  type={visiblePassword ? "text" : "password"}
                  autoComplete={
                    screen === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={screen === "login" ? undefined : 10}
                  maxLength={128}
                  required
                  disabled={busy || !options}
                  aria-describedby={
                    screen !== "login" ? "password-help" : undefined
                  }
                />
                <button
                  type="button"
                  aria-label={
                    visiblePassword ? "Skryť heslo" : "Zobraziť heslo"
                  }
                  aria-pressed={visiblePassword}
                  onClick={() => setVisiblePassword(!visiblePassword)}
                  disabled={busy}
                >
                  {visiblePassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
              {screen !== "login" && (
                <small id="password-help">
                  Aspoň 10 znakov. Môže to byť aj zapamätateľná veta.
                </small>
              )}
            </label>
          )}
          {(screen === "email" || screen === "code") && (
            <label className="field">
              E-mail
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                required
                readOnly={screen === "code"}
                disabled={busy || !options}
              />
            </label>
          )}
          {screen === "code" && (
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
          <button
            className="button primary"
            disabled={
              busy ||
              !options ||
              (screen === "register" && !options.registrationOpen) ||
              (screen === "reset" && !resetToken)
            }
          >
            {busy
              ? "Chvíľku…"
              : !options
                ? "Načítavam…"
                : screen === "register"
                  ? "Vytvoriť účet"
                  : screen === "email"
                    ? "Poslať prihlasovací kód"
                    : screen === "reset"
                      ? "Uložiť nové heslo"
                      : "Prihlásiť sa"}{" "}
            {screen === "register" ? (
              <UserPlus size={18} />
            ) : screen === "email" ? (
              <Mail size={18} />
            ) : (
              <ArrowRight size={18} />
            )}
          </button>
          {!options && error && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setConfigRetry((n) => n + 1)}
            >
              Skúsiť načítať znova
            </button>
          )}
          {screen === "code" && (
            <>
              <button
                type="button"
                className="button secondary"
                disabled={busy || seconds > 0}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await sendCode();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : "Kód sa nepodarilo odoslať.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {seconds > 0 ? `Nový kód o ${seconds} s` : "Poslať nový kód"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => changeScreen("email")}
              >
                Použiť inú adresu
              </button>
            </>
          )}
          {screen === "login" && (
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => setForgotHelp(!forgotHelp)}
              aria-expanded={forgotHelp}
            >
              Zabudol som heslo
            </button>
          )}
          {forgotHelp && (
            <p className="info-note">
              Ozvi sa organizátorovi kurzu. Vytvorí ti jednorazový odkaz, na
              ktorom si nastavíš nové heslo. Svoje heslo mu neposielaj.
            </p>
          )}
          {screen === "reset" && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                clearAuthLink("reset");
                window.location.reload();
              }}
            >
              Späť na prihlásenie
            </button>
          )}
        </form>
        {options?.password && options.emailOtp && screen !== "reset" && (
          <div className="auth-alternative">
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() =>
                changeScreen(
                  screen === "email" || screen === "code" ? "login" : "email",
                )
              }
            >
              {screen === "email" || screen === "code"
                ? "Prihlásiť sa menom a heslom"
                : "Prihlásiť sa e-mailovým kódom"}
            </button>
          </div>
        )}
        <p className="small muted auth-session-note">
          <ShieldCheck size={15} aria-hidden="true" /> Na tomto mobile alebo
          počítači zostaneš prihlásený 30 dní. Pri používaní sa prihlásenie
          priebežne obnovuje.
        </p>
        {screen === "register" && !inviteToken && (
          <p className="small muted">
            Účet si vytvoríš hneď. Prístup k súkromnej skupine následne potvrdí
            organizátor.
          </p>
        )}
      </div>
    </main>
  );
}
