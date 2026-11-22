import { appPath } from "../lib/paths";
import { ArrowUpRight } from "lucide-react";
const steps = [
  [
    "Začni na Domove",
    "Tu máš svoj kalendár, prehľad pohybu a vlastné aktivity. Medzi týždňom a kalendárnym mesiacom prepneš nad kalendárom. Appka si tvoju voľbu zapamätá.",
  ],
  [
    "Pridaj aktivitu",
    "Na Domove stlač Pridať aktivitu. Vyber typ, deň a prípadne trvanie v minútach alebo hodinách. Môžeš pridať poznámku a najviac päť fotografií. Nakoniec zvoľ Uložiť aktivitu.",
  ],
  [
    "Otvor svoj deň",
    "V kalendári sú ikony aktivít. Bublinka znamená komentár, vločka otužovanie. Klepni na deň a otvoríš jeho zápisy. Svoju aktivitu upravíš cez ceruzku v jej detaile.",
  ],
  [
    "Pozri sa, čo zažívajú ostatní",
    "Vo Všetci nájdeš Aktivity s fotografiami a komentármi. V Prehľade prepneš týždeň alebo mesiac a otvoríš konkrétny deň človeka. Ľudia sú zoradení podľa prezývky.",
  ],
  [
    "Zbieraj odmeny",
    "Výzvy a odmeny otvoríš zo svojej zbierky na Domove alebo z ponuky hore. Pri drahokame vidíš presné pravidlá aj započítané aktivity. Praktickú výzvu potvrdíš až po splnení; osobné ocenenie môže udeliť organizátor.",
  ],
  [
    "Pridaj vločku",
    "Keď organizátor sprístupní otužovanie, na Domove sa objaví zimná krajina. Tlačidlom Zaznamenať otužovanie pridáš sprchu alebo otužovanie k vybranému dňu. Každý človek pridá jednu vločku denne; záznam sa nemieša s tréningovými minútami.",
  ],
  [
    "Prečítaj si správy",
    "Zvonček hore otvorí správy organizátorov. Dôležitú správu môžeš vziať na vedomie a presunúť do vlastného archívu. Všetci ostatní ju naďalej uvidia vo svojom účte.",
  ],
  [
    "Uprav profil a upozornenia",
    "Cez svoj avatar alebo ponuku otvor Profil a nastavenia. Zmeníš prezývku, fotografiu, heslo či animácie a zapneš upozornenia. Android: v ponuke prehliadača Nainštalovať aplikáciu. iPhone: Safari → Zdieľať → Pridať na plochu; upozornenia povoľ v takto otvorenej appke.",
  ],
];
export default function Help() {
  return (
    <section className="panel help-panel">
      <p className="section-intro">
        Krátky sprievodca aplikáciou Cestou Zimy. Každý svojím tempom, spoločne
        na jednej ceste.
      </p>
      <ol className="help-steps">
        {steps.map(([title, text], i) => (
          <li key={title}>
            <span className="help-step-number">{i + 1}</span>
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <a
        className="button secondary"
        href={appPath("/navod.html")}
        target="_blank"
        rel="noreferrer"
      >
        Návod na vytlačenie <ArrowUpRight size={17} />
      </a>
    </section>
  );
}
