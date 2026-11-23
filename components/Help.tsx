import { appPath } from "../lib/paths";
import { ArrowUpRight } from "lucide-react";
const steps = [
  [
    "Spolu: čo robí skupina",
    "Po otvorení appky vidíš Spolu. Hore je Dnes v skupine: koľko účastníkov sa dnes hýbalo, aké aktivity pribudli a kto ich zapísal. Pod tým sú aktivity všetkých, zoradené po dňoch. Tlačidlom Filtrovať vyberieš účastníka, typ alebo obdobie.",
  ],
  [
    "Podpor a komentuj",
    "Pod každou aktivitou je Podporiť a Komentovať. Pri karte vidíš, kto už podporil, a posledné dva komentáre. Klepnutím na meno otvoríš prípravu daného účastníka.",
  ],
  [
    "Zapíš aktivitu tlačidlom +",
    "Stredné tlačidlo + v spodnej lište otvorí Nový zápis. Vyber typ, deň (Dnes, Včera alebo Iný deň), trvanie (predvolených 30 min; prepínač min/hod mení len jednotku, číslo ostane) a prípadne vzdialenosť. Môžeš pridať poznámku a najviac päť fotografií. Svoju aktivitu upravíš alebo zmažeš cez tri bodky na jej karte.",
  ],
  [
    "Prehľad skupiny",
    "V Prehľade je jeden riadok na účastníka, zoradené podľa prezývky. Týždňový prehľad sa dá prstom posúvať doľava a doprava cez celú prípravu; mesiac prepneš hore. V rohoch políčka je vločka (otužovanie), fotoaparát (fotka), bublina (komentár) a červené srdiečko, ak si aktivitu podporil(a). Klepnutím na políčko otvoríš daný deň, na meno celú prípravu účastníka; jeho fotku zväčšíš klepnutím.",
  ],
  [
    "Výzvy a odmeny",
    "Vo Výzvach vidíš drahokamy tohto týždňa a celej prípravy s tým, čo ešte chýba. Klepnutím na odmenu uvidíš presné pravidlá aj započítané aktivity. Nižšie sú výzvy organizátorov a tvoja zbierka.",
  ],
  [
    "Otužovanie a vločky",
    "Keď organizátor sprístupní otužovanie, v okne Nový zápis pribudne riadok Otužovanie s tlačidlom + vločka. Zimná krajina so zapojením skupiny je v Prehľade. Vločka sa nemieša s tréningovými minútami; v kalendári ju spoznáš podľa malej vločky.",
  ],
  [
    "Ja: tvoja príprava",
    "V Ja hore nájdeš Appku na ploche a Upozornenia: každé zapneš jedným tlačidlom. Upozornenie príde na správu organizátorov a keď niekto podporí alebo okomentuje tvoju aktivitu; klepnutím sa otvorí priamo daná aktivita. Ďalej je tvoj týždeň alebo mesiac, štatistiky, tvoje zápisy a nastavenia. Organizátor tu nájde aj Administráciu.",
  ],
  [
    "Správy a appka na ploche",
    "Zvonček hore otvorí správy organizátorov a záložku Notifikácie: kto podporil alebo okomentoval tvoje aktivity (funguje aj bez upozornení v telefóne). Dôležitú správu môžeš vziať na vedomie a presunúť do vlastného archívu. Android: v ponuke prehliadača Nainštalovať aplikáciu. iPhone: Safari → Zdieľať → Pridať na plochu; upozornenia povoľ v takto otvorenej appke.",
  ],
];
export default function Help() {
  return (
    <section className="panel help-panel">
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
