import type { PersonalAwardDefinition } from "./types.ts";

/** Editable proposals; nothing is published or granted by installing the app. */
export const DEFAULT_PERSONAL_AWARDS: Omit<
  PersonalAwardDefinition,
  "id" | "createdAt"
>[] = [
  {
    name: "V rukaviciach",
    description:
      "Vyskúšaj si vo svojich rukaviciach zapnúť bundu, otvoriť batoh a otvoriť fľašu. Potvrď, keď máš všetky tri veci vyskúšané.",
    visual: { kind: "icon", value: "glove" },
    mode: "self",
    status: "draft",
  },
  {
    name: "Stan stojí",
    description:
      "Spolu s niekým postavte a opäť zbaľte stan, ktorý použijete na kurze. Podmienkou je celé vyskúšanie, nie rýchlosť ani počasie.",
    visual: { kind: "icon", value: "tent" },
    mode: "self",
    status: "draft",
  },
  {
    name: "Bez signálu",
    description:
      "Stiahni si mapu oblasti podľa pokynov organizátora. Doma zapni režim lietadlo a over, že v mape nájdeš dohodnuté miesto.",
    visual: { kind: "icon", value: "compass" },
    mode: "self",
    status: "draft",
  },
  {
    name: "Zbalené",
    description:
      "Skúšobne zbaľ batoh na kurz, nastav si popruhy a over, že sa dostaneš k rukaviciam, vode a ďalším veciam, ktoré potrebuješ poruke.",
    visual: { kind: "icon", value: "backpack" },
    mode: "self",
    status: "draft",
  },
  {
    name: "Opravené",
    description:
      "Podľa pokynov organizátora si na skúšobnom materiáli vyskúšaj jednu drobnú opravu výbavy, napríklad nalepenie záplaty.",
    visual: { kind: "icon", value: "tool" },
    mode: "self",
    status: "draft",
  },
  {
    name: "Spolu vonku",
    description:
      "Dohodni sa s ďalším účastníkom alebo účastníčkou na spoločnej prechádzke či príprave a absolvujte ju spolu. Dĺžku ani tempo neporovnávame.",
    visual: { kind: "icon", value: "footprints" },
    mode: "self",
    status: "draft",
  },
  {
    name: "Parťák",
    description:
      "Osobné poďakovanie organizátora za konkrétnu pomoc niekomu z kurzu. Organizátor pri udelení doplní, za čo ďakuje.",
    visual: { kind: "icon", value: "heart" },
    mode: "organizer",
    status: "draft",
  },
  {
    name: "Čajový diplomat",
    description:
      "Poďakovanie za konkrétnu pomoc pri spoločnom čaji alebo občerstvení, napríklad prípravu či rozdelenie medzi ľudí. Organizátor pri udelení opíše, za čo ďakuje.",
    visual: { kind: "icon", value: "flame" },
    mode: "organizer",
    status: "draft",
  },
  {
    name: "Baterkový maják",
    description:
      "Poďakovanie za konkrétnu pomoc s osvetlením alebo kontrolou čeloviek pred spoločnou aktivitou. Organizátor uvedie situáciu a poskytnutú pomoc.",
    visual: { kind: "icon", value: "sun" },
    mode: "organizer",
    status: "draft",
  },
  {
    name: "Úsmev do batohu",
    description:
      "Poďakovanie za konkrétny povzbudivý čin pri spoločnej príprave. Organizátor opíše daný moment; počet reakcií, komentárov ani popularita nerozhodujú.",
    visual: { kind: "icon", value: "backpack" },
    mode: "organizer",
    status: "draft",
  },
  {
    name: "Tichá pomoc",
    description:
      "Poďakovanie za nenápadnú praktickú pomoc, napríklad prípravu alebo upratanie spoločnej výbavy. Organizátor pomenuje konkrétnu vykonanú vec.",
    visual: { kind: "icon", value: "heart" },
    mode: "organizer",
    status: "draft",
  },
  {
    name: "Pokojný prístav",
    description:
      "Poďakovanie človeku, ktorý pri zmene plánu pomohol skupine zrozumiteľne dohodnúť ďalší postup. Organizátor uvedie konkrétnu situáciu a prínos.",
    visual: { kind: "icon", value: "compass" },
    mode: "organizer",
    status: "draft",
  },
  {
    name: "Záchranca ponožiek",
    description:
      "Poďakovanie za konkrétnu pomoc s chýbajúcou drobnou výbavou, napríklad požičanie náhradných ponožiek. Nevyžaduje sa nákup; organizátor napíše, čo komu pomohlo.",
    visual: { kind: "icon", value: "boot" },
    mode: "organizer",
    status: "draft",
  },
];
