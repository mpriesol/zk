"use client";
import { useMemo, useState } from "react";
import { Download, Users } from "lucide-react";
import type { Course } from "../lib/types";
import {
  assignAwardCandidates,
  buildAdminStatistics,
  statisticsCsv,
  type AdminReportingData,
  type ReportCategory,
} from "../lib/reporting";

const format = (value: number) =>
  value.toLocaleString("sk-SK", { maximumFractionDigits: 2 });

export default function AdminStatistics({
  data,
  course,
  today,
  authorized,
}: {
  data: AdminReportingData;
  course: Course;
  today: string;
  authorized: boolean;
}) {
  const [startDate, setStartDate] = useState(course.startDate);
  const [endDate, setEndDate] = useState(
    today < course.startDate
      ? course.startDate
      : today < course.endDate
        ? today
        : course.endDate,
  );
  const [includeInactive, setIncludeInactive] = useState(true);
  const [view, setView] = useState<"leaders" | "nominations" | "people">(
    "leaders",
  );
  const [spread, setSpread] = useState(true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const calculation = useMemo(() => {
    try {
      return {
        report: buildAdminStatistics(data, {
          startDate,
          endDate,
          includeInactive,
        }),
        error: "",
      };
    } catch (error) {
      return {
        report: null,
        error:
          error instanceof Error
            ? error.message
            : "Prehľad sa nepodarilo vypočítať.",
      };
    }
  }, [data, startDate, endDate, includeInactive]);
  const report = calculation.report;
  const categories = report ? [...report.leaders, ...report.nominations] : [];
  const selected = categories.filter(
    (category) => enabled[category.id] && category.candidates.length,
  );
  const suggested = assignAwardCandidates(selected, spread);
  const selections: Record<string, string> = {};
  for (const category of selected)
    selections[category.id] = category.candidates.some(
      (candidate) => candidate.memberId === choices[category.id],
    )
      ? choices[category.id]
      : suggested[category.id];
  const selectedPeople = new Set(Object.values(selections));
  const download = () => {
    if (!report || !authorized) return;
    const url = URL.createObjectURL(
      new Blob([statisticsCsv(report, selections)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `priprava-statistiky-${startDate}-${endDate}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!authorized) return null;
  const renderCategory = (category: ReportCategory) => (
    <article className="card stack report-category" key={category.id}>
      <div className="section-heading">
        <h4>{category.name}</h4>
        <span className="pill">
          {category.kind === "leader"
            ? category.candidates.length > 1
              ? "Remíza"
              : "Maximum"
            : `${category.candidates.length} kandidátov`}
        </span>
      </div>
      <p className="small muted">{category.definition}</p>
      {category.candidates.length ? (
        <p>
          {category.kind === "leader" && (
            <strong>
              {format(category.candidates[0].value)} {category.unit} ·{" "}
            </strong>
          )}
          {category.candidates
            .map(
              (person) =>
                person.nickname +
                (person.active ? "" : " (neaktívne členstvo)"),
            )
            .join(", ")}
        </p>
      ) : (
        <p className="muted">
          Vo vybranom období zatiaľ nikto nespĺňa podmienku.
        </p>
      )}
      {category.kind === "leader" &&
        category.ranking.length > category.candidates.length && (
          <details>
            <summary>Ďalšie výsledky ({category.ranking.length})</summary>
            <ul>
              {category.ranking.map((person) => (
                <li key={person.memberId}>
                  {person.nickname}: {format(person.value)} {category.unit}
                  {!person.active ? " · neaktívne členstvo" : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      <label className="check-field">
        <input
          type="checkbox"
          disabled={!category.candidates.length}
          checked={!!enabled[category.id]}
          onChange={(event) =>
            setEnabled({ ...enabled, [category.id]: event.target.checked })
          }
        />
        Pridať kategóriu do návrhu ocenení
      </label>
      {enabled[category.id] && category.candidates.length > 0 && (
        <label className="field">
          {category.kind === "leader"
            ? "Vyber spomedzi spoločných víťazov"
            : "Vyber spomedzi oprávnených kandidátov"}
          <select
            value={selections[category.id] || ""}
            onChange={(event) =>
              setChoices({ ...choices, [category.id]: event.target.value })
            }
          >
            {category.candidates.map((person) => (
              <option key={person.memberId} value={person.memberId}>
                {person.nickname}
                {!person.active ? " (neaktívne členstvo)" : ""}
              </option>
            ))}
          </select>
          {choices[category.id] && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setChoices((previous) => {
                  const next = { ...previous };
                  delete next[category.id];
                  return next;
                })
              }
            >
              Použiť automatický návrh
            </button>
          )}
        </label>
      )}
    </article>
  );
  return (
    <div className="stack admin-statistics">
      <section className="panel stack">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LEN PRE ORGANIZÁTORA</p>
            <h3>Podklady pre záverečné ocenenia</h3>
          </div>
          <Users aria-hidden="true" />
        </div>
        <p>
          Prehľad vychádza zo zapísaných údajov. V „Najviac“ nájdeš skutočné
          maximá aj remízy. Nominácie majú vlastnú podmienku a umožnia poďakovať
          viacerým ľuďom.
        </p>
        <div className="grid-two">
          <label className="field">
            Obdobie od
            <input
              type="date"
              required
              value={startDate}
              onChange={(event) => {
                setStartDate(event.target.value);
                setChoices({});
              }}
            />
          </label>
          <label className="field">
            Obdobie do – vrátane
            <input
              type="date"
              required
              min={startDate}
              value={endDate}
              onChange={(event) => {
                setEndDate(event.target.value);
                setChoices({});
              }}
            />
          </label>
        </div>
        <label className="check-field">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => {
              setIncludeInactive(event.target.checked);
              setChoices({});
            }}
          />
          Zahrnúť aj ľudí s neaktívnym členstvom
        </label>
        {calculation.error && (
          <p className="error" role="alert">
            {calculation.error}
          </p>
        )}
        {report && (
          <>
            <p>
              <strong>{format(report.totals.activities)}</strong> zápisov pohybu
              · <strong>{format(report.totals.activeMembers)}</strong> ľudí s
              pohybom z {format(report.totals.members)} členov
            </p>
            <p className="small muted">
              Čas chýba pri {report.totals.missingMinutes} zápisoch, vzdialenosť
              pri {report.totals.missingDistance}. Súčet používa iba vyplnené
              hodnoty. Hodinu aktivity ani zdravotnú výkonnosť z týchto údajov
              neurčujeme.
            </p>
          </>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={!report}
          onClick={download}
        >
          <Download size={17} />
          Stiahnuť podklady a výber v CSV
        </button>
      </section>
      {report && (
        <>
          <section className="panel stack">
            <h3>Návrh rozdelenia ocenení</h3>
            <label className="check-field">
              <input
                type="checkbox"
                checked={spread}
                onChange={(event) => {
                  setSpread(event.target.checked);
                  setChoices({});
                }}
              />
              Rozdeľ ocenenia medzi čo najviac ľudí
            </label>
            <p className="small muted">
              Vyber kategórie nižšie. Automatický návrh rozdeľuje iba medzi
              ľudí, ktorí spĺňajú podmienku. Pri maxime vyberá len spomedzi
              remizujúcich. Výber môžeš ručne upraviť.
            </p>
            {selected.length ? (
              <>
                <p>
                  <strong>{selected.length}</strong> kategórií pre{" "}
                  <strong>{selectedPeople.size}</strong> rôznych ľudí.{" "}
                  {Object.keys(choices).length > 0
                    ? "Návrh obsahuje tvoje ručné úpravy."
                    : ""}
                </p>
                <ul>
                  {selected.map((category) => (
                    <li key={category.id}>
                      <strong>{category.name}</strong> —{" "}
                      {
                        category.candidates.find(
                          (person) =>
                            person.memberId === selections[category.id],
                        )?.nickname
                      }
                    </li>
                  ))}
                </ul>
                <p className="small muted">
                  Toto je pracovný návrh v otvorenom okne. Ulož ho do CSV;
                  samotné ocenenie udelíš v časti Osobitné ocenenia.
                </p>
              </>
            ) : (
              <p className="muted">Zatiaľ nie je vybraná žiadna kategória.</p>
            )}
          </section>
          <nav className="button-row" aria-label="Druh štatistiky">
            {(
              [
                ["leaders", "Najviac"],
                ["nominations", "Nominácie"],
                ["people", "Ľudia v číslach"],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={`button ${view === key ? "primary" : "secondary"}`}
                aria-pressed={view === key}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          {view !== "people" && (
            <label className="field">
              Nájsť kategóriu
              <input
                type="search"
                placeholder="Napríklad beh, fotky, január…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          )}
          {view === "leaders" && (
            <section className="stack">
              <p className="muted">
                Každá kategória používa iba jednu jasnú metriku. Tieto výsledky
                sa účastníkom nezobrazujú.
              </p>
              {report.leaders.length ? (
                report.leaders
                  .filter((category) =>
                    `${category.name} ${category.definition}`
                      .toLocaleLowerCase("sk")
                      .includes(search.toLocaleLowerCase("sk")),
                  )
                  .map(renderCategory)
              ) : (
                <div className="panel">
                  Vo vybranom období nie sú údaje na porovnanie.
                </div>
              )}
            </section>
          )}
          {view === "nominations" && (
            <section className="stack">
              <p className="muted">
                Každý uvedený človek spĺňa rovnakú podmienku. Poradie mien
                neznamená poradie výkonu.
              </p>
              {report.nominations
                .filter((category) =>
                  `${category.name} ${category.definition}`
                    .toLocaleLowerCase("sk")
                    .includes(search.toLocaleLowerCase("sk")),
                )
                .map(renderCategory)}
            </section>
          )}
          {view === "people" && (
            <section className="panel stack">
              <h3>Prehľad účastníkov</h3>
              <div className="table-scroll" style={{ overflowX: "auto" }}>
                <table className="admin-report-table">
                  <thead>
                    <tr>
                      {[
                        "Účastník",
                        "Pohybové dni",
                        "Týždne",
                        "Zápisy",
                        "Minúty",
                        "Km",
                        "Druhy",
                        "Fotky",
                        "Základné odmeny",
                        "Praktické úlohy",
                        "Dni otužovania",
                      ].map((label) => (
                        <th key={label} scope="col">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.people.map((person) => (
                      <tr key={person.memberId}>
                        <th scope="row">
                          {person.nickname}
                          {!person.active && <small> Neaktívne členstvo</small>}
                        </th>
                        <td>{person.activeDays}</td>
                        <td>{person.activeWeeks}</td>
                        <td>{person.activities}</td>
                        <td>
                          {format(person.minutes)}
                          {person.missingMinutes > 0
                            ? ` (+${person.missingMinutes} bez času)`
                            : ""}
                        </td>
                        <td>{format(person.distance)}</td>
                        <td>{person.distinctTypes}</td>
                        <td>{person.photos}</td>
                        <td>{person.awards}</td>
                        <td>{person.completedTasks}</td>
                        <td>{person.coldDays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                Dni otužovania sú iba evidencia. Neurčujú víťaza a nepripisujú
                sa k pohybu, času ani praktickým nomináciám.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
