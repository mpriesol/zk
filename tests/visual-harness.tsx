/** DEV-only read-only visual harness. This is not imported by the production client. */
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Activity, AppState } from "../lib/types";
import { appPath } from "../lib/paths";
import Group from "../components/Group";
import ErrorBoundary from "../components/ErrorBoundary";
import AdminPanel, { type AdminData } from "../components/AdminPanel";
import Stats from "../components/Stats";
import Feed from "../components/Feed";
import Rewards from "../components/Rewards";
import AwardHistory from "../components/AwardHistory";
import ActivityForm from "../components/ActivityForm";
import Squirrel from "../components/Squirrel";
import { Plus } from "lucide-react";
import "../app/globals.css";
function VisualHarness() {
  const [fixture, setFixture] = useState<{
      participant: AppState;
      admin: AppState;
      adminData: AdminData;
    } | null>(null),
    [error, setError] = useState(""),
    [view, setView] = useState("group"),
    [form, setForm] = useState<Activity | "new" | null>(null),
    [animations, setAnimations] = useState(true);
  useEffect(() => {
    fetch(appPath("/__visual-data"), { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Vizuálna fixture nie je dostupná.");
        setFixture(
          (await r.json()) as {
            participant: AppState;
            admin: AppState;
            adminData: AdminData;
          },
        );
      })
      .catch((e) => setError(e.message));
  }, []);
  async function rejectWrite() {
    throw new Error(
      "Vizuálny test – zápis je vypnutý. Formulár ostal zachovaný.",
    );
  }
  const state = fixture
    ? view === "admin"
      ? fixture.admin
      : fixture.participant
    : null;
  if (!state)
    return (
      <main className="access-screen">
        <p>{error || "Načítavam izolovanú vizuálnu fixture…"}</p>
      </main>
    );
  const visualState = { ...state, me: { ...state.me, animations } };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span>Cestou Zimy</span>
          <small>IZOLOVANÝ VIZUÁLNY TEST</small>
        </div>
        <nav className="main-navigation" aria-label="Vizuálne scenáre">
          {[
            ["group", "Všetci"],
            ["rewards", "Výzvy"],
            ["history", "Zbierka"],
            ["stats", "Grafy"],
            ["feed", "Denník"],
            ["admin", "Administrácia"],
          ].map(([id, label]) => (
            <button
              className={view === id ? "active" : ""}
              key={id}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <label className="check-field" style={{ marginTop: 30 }}>
          <input
            type="checkbox"
            checked={animations}
            onChange={(e) => setAnimations(e.target.checked)}
          />
          Veverička
        </label>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Cestou Zimy</span>
          </div>
          <strong style={{ fontSize: 11 }}>
            Vizuálny test – zápis vypnutý
          </strong>
        </header>
        <main className="main-content">
          <p className="info-note">
            Izolované testovacie údaje. Toto nie je prihlásenie ani prístup do
            kurzu. Zápisy a zmeny sú v tejto ukážke vypnuté.
          </p>
          <div className="page-heading">
            <div>
              <p className="eyebrow">TESTOVACÍ ROČNÍK</p>
              <h1>Spolu sa ide ľahšie.</h1>
            </div>
            <button
              className="button primary add-activity"
              onClick={() => setForm("new")}
            >
              <Plus size={20} />
              Pridať aktivitu
            </button>
          </div>
          <div className="filters">
            {[
              ["group", "Všetci"],
              ["rewards", "Výzvy"],
              ["history", "Zbierka"],
              ["stats", "Grafy"],
              ["feed", "Denník"],
              ["admin", "Administrácia"],
            ].map(([id, label]) => (
              <button
                className={`button ${view === id ? "primary" : "secondary"}`}
                key={id}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {view === "admin" && fixture && (
            <AdminPanel
              state={visualState}
              onAction={rejectWrite}
              visualFixture={fixture.adminData}
            />
          )}{" "}
          {view === "group" && (
            <Group
              state={visualState}
              onEdit={(a) => setForm(a)}
              onAction={rejectWrite}
            />
          )}{" "}
          {view === "rewards" && (
            <Rewards state={visualState} onAction={rejectWrite} />
          )}{" "}
          {view === "history" && (
            <AwardHistory
              awards={state.awards.filter((a) => a.memberId === state.me.id)}
              activities={state.activities}
              progress={state.rules}
            />
          )}
          {view === "stats" && (
            <Stats
              activities={state.activities.filter(
                (a) => a.memberId === state.me.id,
              )}
              today={state.today}
              startDate={state.course.startDate}
            />
          )}{" "}
          {view === "feed" && (
            <Feed
              state={visualState}
              activities={state.activities}
              onEdit={(a) => setForm(a)}
              onAction={rejectWrite}
            />
          )}
        </main>
      </div>
      <Squirrel
        state={visualState}
        blocked={!!form}
        onNavigate={(v) => setView(v === "challenges" ? "rewards" : "group")}
      />
      {form && (
        <ActivityForm
          state={visualState}
          activity={form === "new" ? undefined : form}
          onAction={rejectWrite}
          onClose={() => setForm(null)}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <VisualHarness />
  </ErrorBoundary>,
);
