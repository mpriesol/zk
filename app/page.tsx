"use client";
import { appPath } from "../lib/paths";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Home,
  Users,
  Diamond,
  UserRound,
  Plus,
  Bell,
  ArrowRight,
  CalendarDays,
  Footprints,
  Clock,
  Settings,
  LogOut,
  ChevronRight,
  Check,
  RefreshCw,
  ShieldCheck,
  Menu,
  Mountain,
  ArrowUpRight,
  HelpCircle,
  Snowflake,
  Archive,
} from "lucide-react";
import type { Activity, AppState, Message } from "../lib/types";
import { summarize } from "../lib/gamification";
import { Avatar, Empty, Gem, Modal, fmt, monday, add } from "../components/ui";
import ActivityForm from "../components/ActivityForm";
import Feed from "../components/Feed";
import HomeDashboard from "../components/HomeDashboard";
import AwardCelebration from "../components/AwardCelebration";
import AvatarEditor from "../components/AvatarEditor";
import Help from "../components/Help";
import Stats from "../components/Stats";
import Group from "../components/Group";
import Rewards, { RuleCard } from "../components/Rewards";
import AwardHistory from "../components/AwardHistory";
import AdminPanel from "../components/AdminPanel";
import PushSettings, { disconnectPush } from "../components/PushSettings";
import Squirrel from "../components/Squirrel";
import Login from "../components/Login";
import PasswordSettings from "../components/PasswordSettings";
import {
  authLinkToken,
  authRequest,
  clearAuthLink,
  type AccountInfo,
} from "../components/auth-api";
export const dynamic = "force-dynamic";
const navigation = [
  { id: "home", name: "Domov", icon: Home },
  { id: "group", name: "Všetci", icon: Users },
];
const titles: Record<string, string> = {
  home: "Tvoja príprava.",
  group: "Spolu sa ide ľahšie.",
  challenges: "Výzvy a odmeny.",
  me: "Tvoj profil a nastavenia.",
  messages: "Správy z nášho tábora.",
  admin: "Zázemie organizátorov.",
  help: "Ako na prípravu v appke.",
};
export default function Page() {
  const [state, setState] = useState<AppState | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [access, setAccess] = useState<number | null>(null),
    [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null),
    [recovery, setRecovery] = useState(() => !!authLinkToken("reset")),
    [authLinkVersion, setAuthLinkVersion] = useState(0),
    [view, setView] = useState("home"),
    [form, setForm] = useState<Activity | "new" | null>(null),
    [participantView, setParticipantView] = useState(false),
    [notice, setNotice] = useState(""),
    [selectedDay, setSelectedDay] = useState<string | null>(null),
    [openedMessage, setOpenedMessage] = useState<string | null>(null);
  const account = useRef<string | null>(null);
  const attemptedInvite = useRef<string | null>(null);
  const navigate = useCallback((next: string) => {
    setView(next);
    setSelectedDay(null);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    url.searchParams.delete("message");
    if (next !== "admin") {
      url.searchParams.delete("section");
      url.searchParams.delete("request");
    }
    history.replaceState(null, "", url);
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, []);
  const refresh = useCallback(async () => {
    const accountResponse = await fetch(appPath("/api/account"), {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (accountResponse.status === 401) {
      setState(null);
      setAccountInfo(null);
      setForm(null);
      setSelectedDay(null);
      account.current = null;
      setAccess(401);
      setError("");
      return;
    }
    if (!accountResponse.ok)
      throw new Error(
        "Prihlásenie sa nepodarilo overiť. Skús obnoviť stránku.",
      );
    let info = (await accountResponse.json()) as AccountInfo;
    let inviteError = "";
    const token = authLinkToken("invite");
    if (
      token &&
      attemptedInvite.current !== token &&
      ["pending", "none"].includes(info.membership)
    ) {
      attemptedInvite.current = token;
      try {
        await authRequest("/api/invites/accept", { inviteToken: token });
        info = { ...info, membership: "active" };
        clearAuthLink("invite");
      } catch (error) {
        inviteError =
          error instanceof Error
            ? error.message
            : "Pozvánku sa nepodarilo použiť.";
      }
    } else if (token && info.membership === "active") clearAuthLink("invite");
    setAccountInfo(info);
    if (info.membership === "pending" || info.membership === "revoked") {
      setState(null);
      setForm(null);
      setSelectedDay(null);
      account.current = null;
      setAccess(403);
      setError(inviteError);
      return;
    }
    const response = await fetch(appPath("/api/state"), {
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = (await response.json()) as any;
    if (!response.ok) {
      if ([401, 403, 409].includes(response.status)) {
        setState(null);
        setForm(null);
        setSelectedDay(null);
        account.current = null;
        if (response.status === 401) setAccountInfo(null);
        setAccess(response.status);
        setError(body.error || "Prístup do kurzu zatiaľ nie je aktivovaný.");
        return;
      }
      throw new Error(body.error || "Údaje sa nepodarilo načítať.");
    }
    if (account.current && account.current !== body.me.id) {
      setForm(null);
      setSelectedDay(null);
      setOpenedMessage(null);
      setParticipantView(false);
    }
    account.current = body.me.id;
    setAccountInfo({ ...info, membership: "active" });
    setState(body);
    setAccess(null);
    setError("");
  }, []);
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get("message")) {
      setView("messages");
      setOpenedMessage(u.searchParams.get("message"));
    } else {
      const next = u.searchParams.get("view");
      if (next && titles[next]) setView(next);
    }
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    const resume = () => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => {});
    };
    const pageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    const sessionChange = (event: StorageEvent) => {
      if (event.key === "cz-session-change") {
        setState(null);
        setForm(null);
        setSelectedDay(null);
        setAccountInfo(null);
        setAccess(401);
        void refresh().catch(() => {});
      }
    };
    const authLinkChange = () => {
      setRecovery(!!authLinkToken("reset"));
      setAuthLinkVersion((version) => version + 1);
      attemptedInvite.current = null;
      void refresh().catch((error) => setError(error.message));
    };
    const notificationNavigate = (event: MessageEvent) => {
      if (
        event.data?.type !== "notification-navigate" ||
        typeof event.data.url !== "string"
      )
        return;
      try {
        const url = new URL(event.data.url, window.location.origin);
        const scope = new URL(appPath("/"), window.location.origin);
        if (
          url.origin !== scope.origin ||
          url.pathname.replace(/\/$/, "") !== scope.pathname.replace(/\/$/, "")
        )
          return;
        const target = url.searchParams.get("view") || "messages";
        if (!titles[target]) return;
        history.replaceState(null, "", url);
        setView(target);
        setOpenedMessage(url.searchParams.get("message"));
        void refresh().catch((e) => setError(e.message));
      } catch {
        /* Ignore invalid cross-app notification targets. */
      }
    };
    navigator.serviceWorker?.addEventListener("message", notificationNavigate);
    window.addEventListener("hashchange", authLinkChange);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("storage", sessionChange);
    return () => {
      navigator.serviceWorker?.removeEventListener(
        "message",
        notificationNavigate,
      );
      window.removeEventListener("hashchange", authLinkChange);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("storage", sessionChange);
    };
  }, [refresh]);
  async function action(name: string, data: Record<string, unknown> = {}) {
    const response = await fetch(appPath("/api/action"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: name, ...data }),
      cache: "no-store",
    });
    let body: any;
    try {
      body = await response.json();
    } catch {
      throw new Error(
        "Server nepotvrdil uloženie. Skús to znova; formulár ostal zachovaný.",
      );
    }
    if (!response.ok) {
      if ([401, 403].includes(response.status)) {
        setState(null);
        setForm(null);
        setSelectedDay(null);
        setAccess(response.status);
        if (response.status === 401) setAccountInfo(null);
      }
      throw new Error(body.error || "Zmenu sa nepodarilo uložiť.");
    }
    await refresh();
    if (body.warning) setNotice(body.warning);
    return body;
  }
  async function logout() {
    setState(null);
    setForm(null);
    setSelectedDay(null);
    try {
      await disconnectPush();
    } catch {}
    try {
      const response = await fetch(appPath("/api/auth/sign-out"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error();
      try {
        localStorage.setItem("cz-session-change", String(Date.now()));
      } catch {}
      window.location.reload();
    } catch {
      setError(
        "Server nepotvrdil odhlásenie. Skontroluj pripojenie a použi znova tlačidlo na zmenu účtu.",
      );
    }
  }
  if (loading)
    return (
      <main className="access-screen">
        <div className="brand-access">
          Cestou Zimy<span>PRÍPRAVA NA ZIMNÝ KURZ</span>
        </div>
        <div className="loading-ring" />
        <p className="muted">Otváram tvoj denník…</p>
      </main>
    );
  if (recovery || (!state && !accountInfo && (!access || access === 401)))
    return (
      <Login key={authLinkVersion} onSuccess={() => window.location.reload()} />
    );
  if (!state)
    return (
      <main className="access-screen">
        <div className="access-landscape" />
        <div className="access-card">
          <div className="brand-access">
            Cestou Zimy<span>PRÍPRAVA NA ZIMNÝ KURZ</span>
          </div>
          <h1>
            {accountInfo?.membership === "pending"
              ? "Účet čaká na schválenie."
              : accountInfo?.membership === "revoked"
                ? "Prístup do kurzu je pozastavený."
                : access === 403
                  ? "Prístup do kurzu zatiaľ nie je aktívny."
                  : access === 409
                    ? "Priestor pre váš zimný kurz."
                    : "Začnime spoločnú cestu."}
          </h1>
          <p>
            {accountInfo?.membership === "pending"
              ? "Účet je vytvorený a zostávaš prihlásený. Organizátor ešte potvrdí tvoj vstup do súkromnej skupiny."
              : accountInfo?.membership === "revoked"
                ? "Tvoje členstvo momentálne nie je aktívne. Ozvi sa organizátorovi kurzu."
                : access === 403
                  ? "Do prípravy majú prístup pozvaní alebo schválení členovia kurzu. Ozvi sa organizátorovi."
                  : access === 409
                    ? "Organizátor ešte dokončuje bezpečné prvé nastavenie aplikácie. Po vytvorení kurzu sa tu otvorí tvoj denník."
                    : "Tvoj denník pohybu, spoločné výzvy a správy od organizátorov. Dobrovoľne, bez porovnávania výkonov."}
          </p>
          {error && (
            <p className="info-note" role="status">
              {error}
            </p>
          )}
          {accountInfo && (
            <p className="small muted">
              Prihlásený účet: {accountInfo.username || "e-mailové prihlásenie"}
            </p>
          )}
          <div className="stack">
            <button
              className="button primary"
              onClick={() => {
                attemptedInvite.current = null;
                void refresh().catch((e) => setError(e.message));
              }}
            >
              {accountInfo?.membership === "pending"
                ? "Skontrolovať schválenie"
                : "Obnoviť prístup"}{" "}
              <RefreshCw size={17} />
            </button>
            {accountInfo && (
              <button className="text-button centered" onClick={logout}>
                Použiť iný účet
              </button>
            )}
          </div>
          <p className="small muted">
            Súkromná skupina · pozvánka alebo schválenie organizátorom
          </p>
        </div>
        <img
          className="access-trees"
          src={appPath("/brand/original-frame-0.png")}
          alt=""
        />
      </main>
    );
  const own = state.activities.filter((a) => a.memberId === state.me.id),
    weekActivities = own.filter(
      (a) => a.date >= monday(state.today) && a.date <= state.today,
    ),
    week = summarize(weekActivities),
    unread = state.messages.filter(
      (m) => m.status === "sent" && !m.readAt && !m.archivedAt,
    ).length,
    isAdmin = state.me.role === "admin" && !participantView;
  const currentRules = state.rules.filter(
    (r) =>
      (r.periodStart <= state.today && r.periodEnd >= state.today) ||
      r.rule.period === "course",
  );
  const currentChallenges = state.challenges.filter(
    (c) => !c.hidden && c.status === "published" && c.endDate >= state.today,
  );
  const pinned = state.messages.find(
    (m) => m.status === "sent" && m.important && m.pinned,
  );
  const ownAwards = state.awards.filter((a) => a.memberId === state.me.id);
  const activeView = view === "admin" && !isAdmin ? "home" : view;
  return (
    <div className="app-shell" key={state.me.id}>
      <a href="#main-content" className="skip-link">
        Preskočiť na obsah
      </a>
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("home")}>
          <span>Cestou Zimy</span>
          <small>PRÍPRAVA NA ZIMNÝ KURZ</small>
        </button>
        <div className="sidebar-course">
          <span className="eyebrow">NÁŠ KURZ</span>
          <strong>{state.course.name}</strong>
          <span>
            {fmt(state.course.startDate)} –{" "}
            {fmt(state.course.endDate, {
              day: "numeric",
              month: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
        <nav className="main-navigation" aria-label="Hlavná navigácia">
          {navigation.map((n) => (
            <button
              className={activeView === n.id ? "active" : ""}
              key={n.id}
              onClick={() => navigate(n.id)}
              aria-current={activeView === n.id ? "page" : undefined}
            >
              <n.icon size={21} />
              <span>{n.name}</span>
              {activeView === n.id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={`side-setting ${activeView === "challenges" ? "active" : ""}`}
            onClick={() => navigate("challenges")}
          >
            <Diamond size={18} />
            Výzvy a odmeny
          </button>
          <button
            className={`side-setting ${activeView === "me" ? "active" : ""}`}
            onClick={() => navigate("me")}
          >
            <UserRound size={18} />
            Profil a nastavenia
          </button>
          <button
            className={`side-setting ${activeView === "help" ? "active" : ""}`}
            onClick={() => navigate("help")}
          >
            <HelpCircle size={18} />
            Ako na to
          </button>
          {state.me.role === "admin" && (
            <>
              {!participantView && (
                <button
                  className={`side-setting ${activeView === "admin" ? "active" : ""}`}
                  onClick={() => {
                    setParticipantView(false);
                    navigate("admin");
                  }}
                >
                  <Settings size={18} />
                  Administrácia
                </button>
              )}
            </>
          )}
          <div className="sidebar-person">
            <Avatar imageUrl={state.me.avatarUrl} name={state.me.nickname} />
            <div>
              <strong>{state.me.nickname}</strong>
              <span>
                {state.me.role === "admin" ? "Organizátor" : "Účastník kurzu"}
              </span>
            </div>
            <button
              className="icon-button"
              aria-label="Odhlásiť sa"
              onClick={logout}
            >
              <LogOut size={17} />
            </button>
          </div>
          <a
            href="https://zimnykurz.sk/"
            target="_blank"
            rel="noreferrer"
            className="course-link"
          >
            O kurze Cestou Zimy <ArrowUpRight size={13} />
          </a>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Cestou Zimy</span>
            <ChevronRight size={14} />
            <strong>
              {navigation.find((n) => n.id === activeView)?.name ||
                {
                  admin: "Administrácia",
                  messages: "Správy",
                  challenges: "Výzvy a odmeny",
                  me: "Profil",
                  help: "Ako na to",
                }[activeView] ||
                "Domov"}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="season-label">
              {state.course.year || state.course.endDate.slice(0, 4)}
            </span>
            {state.me.role === "admin" && (
              <label className="role-switch">
                <ShieldCheck size={16} />
                <span className="sr-only">Režim zobrazenia</span>
                <select
                  aria-label="Režim zobrazenia"
                  value={participantView ? "participant" : "admin"}
                  onChange={(e) => {
                    setParticipantView(e.target.value === "participant");
                    if (activeView === "admin") navigate("home");
                  }}
                >
                  <option value="admin">Organizátor</option>
                  <option value="participant">Účastník</option>
                </select>
              </label>
            )}
            <details className="top-menu">
              <summary aria-label="Ďalšie možnosti">
                <Menu size={21} />
              </summary>
              <div>
                {[
                  { id: "challenges", label: "Výzvy a odmeny", icon: Diamond },
                  { id: "me", label: "Profil a nastavenia", icon: UserRound },
                  { id: "help", label: "Ako na to", icon: HelpCircle },
                  ...(isAdmin
                    ? [
                        {
                          id: "admin",
                          label: `Administrácia${state.pendingAccounts ? ` (${state.pendingAccounts})` : ""}`,
                          icon: Settings,
                        },
                      ]
                    : []),
                ].map((item) => (
                  <button
                    key={item.id}
                    onClick={(e) => {
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      navigate(item.id);
                    }}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </button>
                ))}
              </div>
            </details>
            <button
              className={`notification-button ${activeView === "messages" ? "active" : ""}`}
              aria-label={`Oznámenia, ${unread} neprečítaných`}
              onClick={() => navigate("messages")}
            >
              <Bell size={21} />
              {unread > 0 && <span>{unread}</span>}
            </button>
            <button
              className="top-avatar"
              aria-label="Môj profil"
              onClick={() => navigate("me")}
            >
              <Avatar
                imageUrl={state.me.avatarUrl}
                name={state.me.nickname}
                size="small"
              />
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {activeView === "home"
                  ? `AHOJ, ${state.me.nickname.toLocaleUpperCase("sk")}!`
                  : "CESTOU ZIMY / PRÍPRAVA"}
              </p>
              <h1>{titles[activeView]}</h1>
              {activeView === "home" && (
                <p>
                  Príprava {fmt(state.course.startDate)} –{" "}
                  {fmt(state.course.endDate, {
                    day: "numeric",
                    month: "numeric",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          </div>

          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button className="text-button" onClick={() => setNotice("")}>
                Zavrieť
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {activeView === "home" && (
            <HomeDashboard
              state={state}
              onAction={action}
              onAdd={() => setForm("new")}
              onEdit={setForm}
              onDay={setSelectedDay}
              onNavigate={navigate}
              onMessage={(id) => {
                setOpenedMessage(id);
                navigate("messages");
              }}
              allowModeration={!participantView}
            />
          )}
          {activeView === "group" && (
            <Group
              state={state}
              onEdit={(a) => setForm(a)}
              onAction={action}
              allowModeration={!participantView}
            />
          )}
          {activeView === "challenges" && (
            <Rewards state={state} onAction={action} />
          )}
          {activeView === "me" && (
            <>
              <Profile
                state={state}
                action={action}
                onLogout={logout}
                onRefresh={refresh}
              />
              <PasswordSettings account={accountInfo} onChanged={refresh} />
            </>
          )}
          {activeView === "help" && <Help />}
          {activeView === "messages" && (
            <Messages
              state={state}
              action={action}
              opened={openedMessage}
              setOpened={setOpenedMessage}
            />
          )}
          {activeView === "admin" && isAdmin && (
            <AdminPanel
              state={state}
              onAction={action}
              onMembershipChanged={refresh}
            />
          )}
          <footer className="page-footer">
            <span>Cestou Zimy · každý svojím tempom</span>
            <button className="text-button" onClick={() => navigate("help")}>
              Ako na to <HelpCircle size={14} />
            </button>
          </footer>
        </main>
      </div>
      <nav className="mobile-navigation" aria-label="Mobilná navigácia">
        {navigation.map((n) => (
          <button
            className={activeView === n.id ? "active" : ""}
            key={n.id}
            onClick={() => navigate(n.id)}
            aria-current={activeView === n.id ? "page" : undefined}
          >
            <n.icon size={22} />
            <span>{n.name}</span>
          </button>
        ))}
      </nav>
      <AwardCelebration
        state={state}
        blocked={!!form || !!selectedDay || activeView === "admin"}
        onOpen={() => navigate("challenges")}
      />
      <Squirrel
        state={state}
        blocked={!!form || !!selectedDay || activeView === "admin"}
        onNavigate={navigate}
      />
      {form && (
        <ActivityForm
          state={state}
          activity={form === "new" ? undefined : form}
          onAction={action}
          onClose={() => setForm(null)}
        />
      )}{" "}
      {selectedDay && (
        <Modal
          title={`Tvoj deň · ${fmt(selectedDay, { day: "numeric", month: "long" })}`}
          onClose={() => setSelectedDay(null)}
        >
          {state.cold?.calendar.some(
            (c) => c.memberId === state.me.id && c.date === selectedDay,
          ) && (
            <p className="cold-day-note">
              <Snowflake size={18} />V tento deň si pridala/pridal aj vločku za
              otužovanie.
            </p>
          )}
          <Feed
            state={state}
            activities={own.filter((a) => a.date === selectedDay)}
            onEdit={(a) => {
              setSelectedDay(null);
              setForm(a);
            }}
            onAction={action}
            allowModeration={!participantView}
            compact
          />
        </Modal>
      )}
    </div>
  );
}
function Profile({
  state,
  action,
  onLogout,
  onRefresh,
}: {
  state: AppState;
  action: (a: string, d?: Record<string, unknown>) => Promise<any>;
  onLogout: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = useState(state.me.nickname),
    [animations, setAnimations] = useState(state.me.animations),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="profile-grid">
      <section className="panel">
        <div className="profile-title">
          <Avatar
            imageUrl={state.me.avatarUrl}
            name={state.me.nickname}
            size="large"
          />
          <div>
            <p className="eyebrow">TVOJ PROFIL</p>
            <h2>{state.me.nickname}</h2>
            <p className="muted small">
              Ostatní vidia tvoju prezývku. Celé meno nepotrebujeme.
            </p>
          </div>
        </div>
        <AvatarEditor avatarUrl={state.me.avatarUrl} onChanged={onRefresh} />
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await action("saveProfile", { nickname: name, animations });
              setMessage("Nastavenia sú uložené.");
            } catch (e) {
              setMessage(
                e instanceof Error ? e.message : "Nepodarilo sa uložiť.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Meno alebo prezývka
            <input
              value={name}
              minLength={2}
              maxLength={50}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={animations}
              onChange={(e) => setAnimations(e.target.checked)}
            />
            <span>
              Povoliť medvedíka a oslavy odmien
              <small>Správy a odmeny ostávajú dostupné aj bez animácií.</small>
            </span>
          </label>
          <div className="button-row">
            <button className="button primary" disabled={busy}>
              {busy ? "Ukladám…" : "Uložiť nastavenia"}
            </button>
            <button className="text-button" type="button" onClick={onLogout}>
              Odhlásiť sa
            </button>
          </div>
          {message && (
            <p role="status" className="small">
              {message}
            </p>
          )}
        </form>
      </section>
      <section className="panel">
        <p className="eyebrow">LEN KEĎ SI TO ŽELÁŠ</p>
        <h2>Upozornenia</h2>
        <PushSettings
          configured={state.pushConfigured}
          publicKey={state.vapidPublicKey}
          api={action}
        />
        <div className="pwa-help">
          <h3>Aplikácia na ploche</h3>
          <p className="small muted">
            Android: v ponuke prehliadača vyber „Nainštalovať aplikáciu“ alebo
            „Pridať na plochu“. iPhone: v Safari otvor Zdieľať → Pridať na
            plochu. Potom aplikáciu otvor cez novú ikonu.
          </p>
        </div>
      </section>
    </div>
  );
}
function Messages({
  state,
  action,
  opened,
  setOpened,
}: {
  state: AppState;
  action: (a: string, d?: Record<string, unknown>) => Promise<any>;
  opened: string | null;
  setOpened: (s: string | null) => void;
}) {
  const [error, setError] = useState("");
  const [archive, setArchive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const all = state.messages
    .filter((m) => m.status === "sent")
    .sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || ""));
  const messages = all.filter((m) =>
    archive ? !!m.archivedAt : !m.archivedAt,
  );
  useEffect(() => {
    const msg = all.find((m) => m.id === opened);
    if (msg?.archivedAt) setArchive(true);
    if (msg && !msg.readAt)
      void action("readMessage", { id: msg.id }).catch((e) =>
        setError(e.message),
      );
  }, [opened]);
  return (
    <section className="messages-list">
      <div
        className="segmented message-folders"
        role="group"
        aria-label="Priečinok správ"
      >
        <button
          aria-pressed={!archive}
          onClick={() => {
            setArchive(false);
            setOpened(null);
          }}
        >
          Správy
        </button>
        <button
          aria-pressed={archive}
          onClick={() => {
            setArchive(true);
            setOpened(null);
          }}
        >
          <Archive size={16} />
          Archív · {all.filter((m) => m.archivedAt).length}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {opened && !all.some((m) => m.id === opened) && (
        <p className="info-note">
          Táto správa už nie je dostupná alebo nie je určená tvojmu účtu.
          Ostatné správy nájdeš nižšie.
        </p>
      )}
      {!messages.length ? (
        <Empty
          title={
            archive
              ? "Archív je zatiaľ prázdny"
              : "Všetko prečítané? Tu budú nové správy."
          }
        >
          {archive
            ? "Sem sa presunú správy, ktoré vezmeš na vedomie."
            : "Oznámenia organizátorov ostávajú dostupné aj bez zapnutých upozornení."}
        </Empty>
      ) : (
        messages.map((m) => (
          <article
            key={m.id}
            className={`message-card ${!m.readAt ? "unread" : ""}`}
          >
            <button
              className="message-title"
              onClick={() => setOpened(opened === m.id ? null : m.id)}
              aria-expanded={opened === m.id}
            >
              <span className="message-bell">
                <Bell size={20} />
              </span>
              <span>
                <span className="message-meta">
                  {m.important && <span className="pill soft">Dôležité</span>}
                  {!m.readAt && (
                    <span className="unread-label">Neprečítané</span>
                  )}
                  <time>{fmt(m.sentAt || m.createdAt)}</time>
                </span>
                <h2>{m.title}</h2>
                {opened !== m.id && (
                  <p>
                    {m.body.slice(0, 135)}
                    {m.body.length > 135 ? "…" : ""}
                  </p>
                )}
              </span>
              <ChevronRight size={20} />
            </button>
            {opened === m.id && (
              <div className="message-content">
                <p className="pre-wrap">{m.body}</p>
                {m.link && (
                  <a className="button secondary" href={appPath(m.link)}>
                    Otvoriť odkaz <ArrowRight size={16} />
                  </a>
                )}
                <button
                  className="button secondary"
                  disabled={busy === m.id}
                  onClick={async () => {
                    setBusy(m.id);
                    setError("");
                    try {
                      await action("archiveMessage", {
                        id: m.id,
                        archived: !m.archivedAt,
                      });
                      setOpened(null);
                    } catch (e) {
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Správu sa nepodarilo presunúť.",
                      );
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  <Archive size={16} />
                  {busy === m.id
                    ? "Ukladám…"
                    : m.archivedAt
                      ? "Vrátiť medzi správy"
                      : "Beriem na vedomie · archivovať"}
                </button>
                <span className="small muted">
                  Táto zmena sa týka iba tvojho účtu.
                </span>
              </div>
            )}
          </article>
        ))
      )}
    </section>
  );
}
