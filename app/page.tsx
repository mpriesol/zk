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
} from "lucide-react";
import type { Activity, AppState, Message, Identity } from "../lib/types";
import { summarize } from "../lib/gamification";
import { Avatar, Empty, Gem, Modal, fmt, monday, add } from "../components/ui";
import ActivityForm from "../components/ActivityForm";
import Feed from "../components/Feed";
import Stats from "../components/Stats";
import Group from "../components/Group";
import Rewards, { RuleCard } from "../components/Rewards";
import AwardHistory from "../components/AwardHistory";
import AdminPanel from "../components/AdminPanel";
import PushSettings, { disconnectPush } from "../components/PushSettings";
import Squirrel from "../components/Squirrel";
import Login from "../components/Login";
export const dynamic = "force-dynamic";
const navigation = [
  { id: "home", name: "Domov", icon: Home },
  { id: "group", name: "Všetci", icon: Users },
  { id: "challenges", name: "Výzvy", icon: Diamond },
  { id: "me", name: "Ja", icon: UserRound },
];
const titles: Record<string, string> = {
  home: "Tvoja cesta sa začína dnes.",
  group: "Spolu sa ide ľahšie.",
  challenges: "Malé kroky. Veľké zážitky.",
  me: "Tvoj vlastný rytmus.",
  messages: "Správy z nášho tábora.",
  admin: "Zázemie organizátorov.",
};
export default function Page() {
  const [state, setState] = useState<AppState | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [access, setAccess] = useState<number | null>(null),
    [identity, setIdentity] = useState<Identity | null>(null),
    [view, setView] = useState("home"),
    [form, setForm] = useState<Activity | "new" | null>(null),
    [participantView, setParticipantView] = useState(false),
    [notice, setNotice] = useState(""),
    [selectedDay, setSelectedDay] = useState<string | null>(null),
    [openedMessage, setOpenedMessage] = useState<string | null>(null);
  const account = useRef<string | null>(null);
  const navigate = useCallback((next: string) => {
    setView(next);
    setSelectedDay(null);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    url.searchParams.delete("message");
    history.replaceState(null, "", url);
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, []);
  const refresh = useCallback(async () => {
    const response = await fetch(appPath("/api/state"), { cache: "no-store" });
    const body = (await response.json()) as any;
    if (!response.ok) {
      if ([401, 403, 409].includes(response.status)) {
        setState(null);
        setForm(null);
        setSelectedDay(null);
        account.current = null;
        if (response.status === 401) setIdentity(null);
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
    Promise.all([
      refresh(),
      fetch(appPath("/api/identity"), { cache: "no-store" })
        .then((r) => r.json())
        .then((d: any) => setIdentity(d.identity)),
    ])
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
        setIdentity(null);
        setAccess(401);
        void refresh().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("storage", sessionChange);
    return () => {
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
        if (response.status === 401) setIdentity(null);
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
  if (!state && !identity && (!access || access === 401))
    return <Login onSuccess={() => window.location.reload()} />;
  if (!state)
    return (
      <main className="access-screen">
        <div className="access-landscape" />
        <div className="access-card">
          <div className="brand-access">
            Cestou Zimy<span>PRÍPRAVA NA ZIMNÝ KURZ</span>
          </div>
          <h1>
            {access === 403
              ? "Tvoja pozvánka ešte čaká."
              : access === 409
                ? "Priestor pre váš zimný kurz."
                : "Začnime spoločnú cestu."}
          </h1>
          <p>
            {access === 403
              ? "Do prípravy majú prístup pozvaní členovia kurzu. Organizátor musí pridať e-mail tvojho prihláseného účtu."
              : access === 409
                ? "Organizátor ešte dokončuje bezpečné prvé nastavenie aplikácie. Po vytvorení kurzu sa tu otvorí tvoj denník."
                : "Tvoj denník pohybu, spoločné výzvy a správy od organizátorov. Dobrovoľne, bez porovnávania výkonov."}
          </p>
          {error && (
            <p className="info-note" role="status">
              {error}
            </p>
          )}
          {identity && (
            <p className="small muted">Prihlásený účet: {identity.email}</p>
          )}
          <div className="stack">
            <button
              className="button primary"
              onClick={() => void refresh().catch((e) => setError(e.message))}
            >
              Obnoviť prístup <RefreshCw size={17} />
            </button>
            {identity && (
              <button className="text-button centered" onClick={logout}>
                Použiť iný účet
              </button>
            )}
          </div>
          <p className="small muted">Súkromná skupina · vstup na pozvanie</p>
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
      (m) => m.status === "sent" && !m.readAt,
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
              <button
                className="side-setting"
                onClick={() => {
                  setParticipantView(!participantView);
                  navigate("home");
                }}
              >
                <ShieldCheck size={18} />
                {participantView
                  ? "Späť do roly organizátora"
                  : "Účastnícke zobrazenie"}
              </button>
            </>
          )}
          <div className="sidebar-person">
            <Avatar name={state.me.nickname} />
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
                (activeView === "admin" ? "Administrácia" : "Oznámenia")}
            </strong>
          </div>
          <div className="topbar-actions">
            {state.course.testMode && (
              <span className="test-label">TESTOVACÍ ROČNÍK</span>
            )}
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
              <Avatar name={state.me.nickname} size="small" />
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
                  Niekoľko týždňov prípravy. Každý svojím tempom, spolu na
                  jednej ceste.
                </p>
              )}
            </div>
            <button
              className="button primary add-activity"
              onClick={() => setForm("new")}
            >
              <Plus size={20} />
              Pridať aktivitu
            </button>
          </div>
          {state.me.role === "admin" && (
            <div className="role-preview-bar">
              <span>
                {participantView
                  ? "Účastnícke zobrazenie · moderátorské ovládanie je skryté."
                  : "Organizátorské zobrazenie"}
              </span>
              <button
                className="button secondary"
                onClick={() => {
                  setParticipantView(!participantView);
                  navigate("home");
                }}
              >
                <ShieldCheck size={16} />
                {participantView
                  ? "Späť do organizácie"
                  : "Zobraziť ako účastník"}
              </button>
            </div>
          )}
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
            <>
              <div className="overview-layout">
                <div className="overview-main">
                  <section className="week-card">
                    <div className="section-head">
                      <div>
                        <p className="eyebrow">TVOJ TÝŽDEŇ V SKRATKE</p>
                        <h2>
                          {fmt(monday(state.today))} –{" "}
                          {fmt(add(monday(state.today), 6))}
                        </h2>
                      </div>
                      <CalendarDays size={23} />
                    </div>
                    <div className="week-stats">
                      <div>
                        <span className="stat-icon">
                          <Footprints size={19} />
                        </span>
                        <strong>{week.movementDays}</strong>
                        <span>pohybové dni</span>
                      </div>
                      <div>
                        <span className="stat-icon">
                          <Clock size={19} />
                        </span>
                        <strong>
                          {week.minutes === null ? "—" : week.minutes}
                        </strong>
                        <span>zapísané minúty</span>
                      </div>
                      <div>
                        <span className="stat-icon">
                          <Diamond size={19} />
                        </span>
                        <strong>
                          {
                            ownAwards.filter(
                              (a) => a.periodStart >= monday(state.today),
                            ).length
                          }
                        </strong>
                        <span>nové odmeny</span>
                      </div>
                    </div>
                    <div className="week-days">
                      {Array.from({ length: 7 }, (_, i) =>
                        add(monday(state.today), i),
                      ).map((d, i) => {
                        const n = own.filter((a) => a.date === d).length;
                        return (
                          <button
                            key={d}
                            className={`${n ? "recorded" : ""} ${d === state.today ? "today" : ""}`}
                            disabled={d > state.today}
                            onClick={() => setSelectedDay(d)}
                            aria-label={`${fmt(d)}: ${n ? n + " zápisov" : "bez zápisu"}`}
                          >
                            <span>
                              {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"][i]}
                            </span>
                            <i>
                              {n ? <Check size={16} /> : Number(d.slice(-2))}
                            </i>
                            {n > 1 && <sup>{n}</sup>}
                          </button>
                        );
                      })}
                    </div>
                    <p className="small muted">
                      {week.missingMinutes
                        ? `${week.missingMinutes} zápisov bez uvedeného trvania. `
                        : ""}
                      Počítame zapísaný pohyb, nie tvoju pripravenosť na kurz.
                    </p>
                  </section>
                  {pinned && (
                    <button
                      className="pinned-message"
                      onClick={() => {
                        setOpenedMessage(pinned.id);
                        navigate("messages");
                      }}
                    >
                      <span className="pinned-icon">
                        <Bell size={21} />
                      </span>
                      <span>
                        <small>DÔLEŽITÉ OD ORGANIZÁTOROV</small>
                        <strong>{pinned.title}</strong>
                        <span>
                          {pinned.body.slice(0, 120)}
                          {pinned.body.length > 120 ? "…" : ""}
                        </span>
                      </span>
                      <ChevronRight size={19} />
                    </button>
                  )}
                  <Feed
                    state={state}
                    activities={state.activities}
                    onEdit={(a) => setForm(a)}
                    onAction={action}
                    allowModeration={!participantView}
                    compact
                    limit={5}
                  />
                </div>
                <aside className="overview-aside">
                  <section className="panel collection-preview">
                    <div className="section-head">
                      <h2>Tvoje drahokamy</h2>
                      <button
                        className="icon-button"
                        aria-label="Pozrieť odmeny"
                        onClick={() => navigate("challenges")}
                      >
                        <ArrowUpRight size={19} />
                      </button>
                    </div>
                    <div className="gem-line">
                      {currentRules.map((r, i) => (
                        <button
                          key={r.rule.id}
                          title={`${r.rule.name}: ${r.progress.complete ? "získané" : r.progress.missing}`}
                          onClick={() => navigate("challenges")}
                        >
                          <Gem index={i} earned={r.progress.complete} />
                          <span>{r.rule.name}</span>
                        </button>
                      ))}
                    </div>
                    <p className="small muted">
                      Každý za niečo iné. Žiadne poradie, žiadne preteky.
                    </p>
                    <button
                      className="text-button teal"
                      onClick={() => navigate("challenges")}
                    >
                      Ako ich získať <ArrowRight size={15} />
                    </button>
                  </section>
                  {currentRules.find((r) => !r.progress.complete) && (
                    <RuleCard
                      item={currentRules.find((r) => !r.progress.complete)!}
                      index={0}
                      state={state}
                      onAction={action}
                      small
                    />
                  )}
                  <section className="panel challenge-preview">
                    <span className="eyebrow">OD ORGANIZÁTOROV</span>
                    <h2>
                      {currentChallenges.length
                        ? "Výzva na obzore"
                        : "Priestor na nové výzvy"}
                    </h2>
                    {currentChallenges.length ? (
                      <>
                        <span className="pill soft">
                          {currentChallenges[0].startDate > state.today
                            ? "Už zverejnená · začne čoskoro"
                            : "Aktuálna výzva"}
                        </span>
                        <h3>{currentChallenges[0].name}</h3>
                        <p>{currentChallenges[0].description.slice(0, 145)}</p>
                        <span className="small muted">
                          Do {fmt(currentChallenges[0].endDate)} vrátane
                        </span>
                      </>
                    ) : (
                      <p>
                        Keď organizátori zverejnia výzvu, nájdeš ju tu. Dovtedy
                        môžeš objavovať vlastný rytmus.
                      </p>
                    )}
                    <button
                      className="text-button teal"
                      onClick={() => navigate("challenges")}
                    >
                      Pozrieť výzvy <ArrowRight size={15} />
                    </button>
                  </section>
                  <div className="quiet-reminder">
                    <img
                      src={appPath("/brand/hory_title_complete.png")}
                      alt=""
                    />
                    <p>
                      Do hôr pôjdeme spolu.
                      <br />
                      Príprava je tvoja vlastná cesta.
                    </p>
                  </div>
                </aside>
              </div>
            </>
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
              <Profile state={state} action={action} onLogout={logout} />
              <Stats
                startDate={state.course.startDate}
                activities={own}
                today={state.today}
                onDay={setSelectedDay}
              />
              <section className="panel">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">ODMENY ZA TVOJE ZÁPISY</p>
                    <h2>
                      Získané drahokamy{" "}
                      <span className="count-text">{ownAwards.length}</span>
                    </h2>
                  </div>
                </div>
                <AwardHistory
                  awards={ownAwards}
                  activities={own}
                  progress={state.rules}
                />
              </section>
              <Feed
                state={state}
                activities={own}
                onEdit={(a) => setForm(a)}
                onAction={action}
                allowModeration={!participantView}
              />
            </>
          )}
          {activeView === "messages" && (
            <Messages
              state={state}
              action={action}
              opened={openedMessage}
              setOpened={setOpenedMessage}
            />
          )}
          {activeView === "admin" && isAdmin && (
            <AdminPanel state={state} onAction={action} />
          )}
          <footer className="page-footer">
            <span>Cestou Zimy · každý svojím tempom</span>
            <span>{state.course.timezone} · týždeň pondelok – nedeľa</span>
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
        {isAdmin && (
          <button
            className={activeView === "admin" ? "active" : ""}
            onClick={() => {
              setParticipantView(false);
              navigate("admin");
            }}
          >
            <Settings size={22} />
            <span>Správa</span>
          </button>
        )}
      </nav>
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
}: {
  state: AppState;
  action: (a: string, d?: Record<string, unknown>) => Promise<any>;
  onLogout: () => void;
}) {
  const [name, setName] = useState(state.me.nickname),
    [animations, setAnimations] = useState(state.me.animations),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="profile-grid">
      <section className="panel">
        <div className="profile-title">
          <Avatar name={state.me.nickname} size="large" />
          <div>
            <p className="eyebrow">TVOJ PROFIL</p>
            <h2>{state.me.nickname}</h2>
            <p className="muted small">
              Ostatní vidia tvoju prezývku, nie e-mail.
            </p>
          </div>
        </div>
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
              Povoliť občasné vykuknutie veveričky
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
  const messages = state.messages
    .filter((m) => m.status === "sent")
    .sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || ""));
  useEffect(() => {
    const msg = messages.find((m) => m.id === opened);
    if (msg && !msg.readAt)
      void action("readMessage", { id: msg.id }).catch((e) =>
        setError(e.message),
      );
  }, [opened]);
  return (
    <section className="messages-list">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!messages.length ? (
        <Empty title="Zatiaľ žiadne správy">
          Oznámenia od organizátorov ostávajú tu, aj keď si nezapneš
          upozornenia.
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
                <div className="message-meta">
                  {m.important && <span className="pill soft">Dôležité</span>}
                  {!m.readAt && (
                    <span className="unread-label">Neprečítané</span>
                  )}
                  <time>{fmt(m.sentAt || m.createdAt)}</time>
                </div>
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
                <span className="small muted">
                  Prečítané len v tvojom účte.
                </span>
              </div>
            )}
          </article>
        ))
      )}
    </section>
  );
}
