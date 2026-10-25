# Overenie aplikácie

## Súhrn odovzdanej verzie (25. 10. 2026)

- `npm run typecheck`: bez chýb.
- `npm test`: **106/106 úspešných**, 0 preskočených. Rozdelenie: pravidlá 19, backend 40, autentifikácia 18, push/outbox 20, záloha/obnova 2, veverička 5 a request ID 2.
- Produkčný build osobitne s `APP_URL=https://hub.biketrek.sk/zk` aj `APP_URL=https://zimnykurz.sk/priprava`: úspešný. Skontrolované prefixy HTML/manifestu, ikony a absencia vývojového vizuálneho testu v klientskom balíku.
- Produkčný Node runtime spustený s novou dočasnou SQLite osobitne pre `/zk` aj `/priprava`: úspešné HTTP kontroly presmerovania na prefix, HTML/assetov, manifestu, service workera, neprihláseného API (401), odmietnutia cudzieho Host, nesprávneho prefixu a izolácie vývojových súborov. SMTP ani push sa pri tejto skúške neposielali.
- Caddy 2.11.7: **22 živých lokálnych kontrol** oboch nasadení, vrátane zachovania ostatných ciest, query, request body, hlavičiek a cookies. `scripts/check-caddy.mjs` je opakovateľná kontrola; nejde o skúšku na produkčnom Hube.
- Prehliadač Chrome: skutočná neprihlásená stránka a izolované komponentové vizuálne testy na desktope vrátane šírok 1920 a 2560 px a v šírkach 360, 390 a 768 px. Overená matica/skupina, odmeny, administrácia, formulár a zachovanie jeho textu po odmietnutí zápisu. Bez horizontálneho pretečenia celej stránky. Pri formulári sa veverička schová.

Vizuálny test `tests/visual-harness.tsx` sa zapína iba vo vývoji cez `ENABLE_VISUAL_QA=1`, používa výslovne označené fiktívne údaje a má vypnuté zápisy. **Nie je to prihlásenie ani end-to-end skúška prihláseného používateľa v prehliadači.** Nie je súčasťou produkčného buildu.

Auth sada používa skutočnú Better Auth, jednorazové kódy, session/cookies a SQLite; zahŕňa vypršanie/chybné kódy, oprávnenia, opätovné otvorenie databázy a prepnutie z Hub URL na verejnú URL pri zachovaní účtov. E-maily zachytáva do izolovaného testovacieho transportu, neposiela ich externým ľuďom.

**Pred prevádzkou zostáva overiť:** Docker build a štart na Hube (v testovacom prostredí nie je Docker), produkčné SMTP doručenie, plný prihlasovací priebeh v používateľskom prehliadači, PWA a push na skutočnom Androide/iPhone, pravidelnú zálohu a obnovu na serveri a neskôr verejnú proxy na hostingu zimnykurz.sk. Produkcia, DNS ani existujúci bežiaci Caddy sa počas implementácie nemenili.

## Automatické integračné overenie backendu

Príkaz: `node --experimental-strip-types --test tests/server.test.ts` (súčasť `npm test`).

Posledné samostatné spustenie tejto sady: **40 testov, 40 úspešných, 0 neúspešných**. Testy vytvárajú pre každý scenár novú skutočnú SQLite databázu z verzovaných SQL migrácií v `drizzle/`. Adaptér implementuje používané rozhranie D1 vrátane atómových batch operácií. Nepoužíva localStorage ani falošné výsledky SQL.

Overené scenáre:

- Pozvaný používateľ má prístup; neprihlásený a cudzí účet ho nemajú.
- Účastník si nemôže prideliť rolu, otvoriť administráciu/export ani meniť cudzie aktivity.
- Zrušenie členstva ihneď zablokuje už známu identitu.
- Účastník nedostáva e-maily ostatných členov, subscription údaje ani privátny push kľúč. Súkromné odpovede majú `no-store`.
- Aktivita je trvalá medzi požiadavkami a viditeľná druhému oprávnenému účtu.
- Opakovanie aj súbežné odoslanie rovnakého idempotentného zápisu nevytvorí duplicitu; dve rôzne aktivity v jeden deň zostanú dve aktivity a jeden pohybový deň.
- Neznáme trvanie zostáva `null`, nepripočítava nulu ako známy čas a má samostatný počet chýbajúcich trvaní.
- Nedeľa spätne dopísaná v pondelok patrí do správneho týždňa. Zmena dátumu a zmazanie prepočítajú odmeny aj štatistiky.
- Neplatné dátumy, budúce záznamy, zápisy mimo prípravy a záporné hodnoty sú odmietnuté.
- Skryté typy a výzvy nie sú v účastníckych odpovediach. Publikovanie jednej tajnej výzvy neodhalí druhú. Ani koncept s `hidden=false` sa účastníkovi neposiela.
- Komentáre a reakcie sú trvalé, komentár môže upravovať iba autor a organizátor ho môže odstrániť.
- Oznámenie vidia iba adresáti. Opakované/súbežné odoslanie nevytvorí ďalších adresátov. Stav prečítania patrí konkrétnemu členovi. Nový člen nevidí staré cielené oznámenie.
- Zmena pravidla sa uplatňuje do budúcnosti, stará odmena si uchová snapshot a oprava starého zápisu používa správnu verziu.
- Opakovaný výpočet zachová ID odmien. Zmazanie podkladových záznamov odoberie neplatnú odmenu.
- Spätný prepočet vyžaduje náhľad dôsledkov, odmieta zastaraný náhľad a po úspechu zneplatní jeho token.
- Cudzí HTTP Origin nemôže zapisovať. Vloženie cudzieho `courseId` alebo `memberId` neposkytne prístup do iného kurzu.
- Manuálna praktická úloha nemení tréningové minúty ani pohybové dni.
- Deväť CSV exportov (aktivity, členovia, odmeny, výzvy, splnenia, oznámenia, adresáti, komentáre a reakcie) je dostupných iba organizátorovi a oddelených podľa kurzu. Zachovávajú aj históriu neaktívnych členov. Text začínajúci vzorcom vrátane úvodných medzier je chránený pred vykonaním tabuľkovým procesorom. Auth/session/OTP/push tajomstvá sa neexportujú.
- Neplatný kalendárny dátum, neobjektový JSON a chybný push odber vracajú 400; privátny VAPID kľúč sa do odpovede nedostane.
- Push registrácia uchováva serverom určenú adresu nasadenia. Test pokrýva presun z `https://hub.biketrek.sk/zk` na `https://zimnykurz.sk/priprava`, zmenu samotnej cesty, normalizáciu koncovej lomky, ignorovanie podvrhnutej klientovej adresy, vyradenie starého neoznačeného odberu a zákaz zásahu do cudzieho zariadenia.
- Organizátor môže moderátorsky zmazať cudzí zápis s auditom a prepočtom autora, ale nemôže ho upraviť. Neaktívny typ možno zachovať pri oprave historického záznamu, nie použiť na nový.
- Náhľad spätného prepočtu uvádza konkrétne pridané/odobraté obdobia aj pri nezmenenom celkovom počte. Zmena nastavení kurzu náhľad zneplatní.
- Historické manuálne podmienky sa viažu na deň potvrdenia, nie na každý týždeň. Nové manuálne podmienky sú pri základných odmenách povolené iba pre Výbavu.
- Kombinovaná ad-hoc výzva rozlišuje potvrdenie praktickej časti od úplného splnenia. Vlastný deň a poznámku vracia na úpravu.
- SMTP režim vie zaradiť pozvánku do fronty bez druhého poskytovateľa e-mailov.
- Prvotná zmena termínov zosúladí nepoužité pravidlá a celokurzové skryté koncepty. Neskoršia zmena nevylúči existujúce potvrdenia ani publikované výzvy.
- Súbežné odobratie roly dvoch organizátorov nemôže zanechať kurz bez aktívneho organizátora.
- Manuálne ukončenie výzvy uzavrie plnenie dnešným dňom vrátane. Spätná oprava v uzavretom období ostáva možná, zrušenie pred začiatkom nevytvorí žiadny progres a ukončenú výzvu nemožno znovu publikovať.
- Zámerne vyvolaná databázová chyba pri spätnom prepočte vráti celú transakciu: verzia pravidla, odmeny, audit a použitie náhľadu sa zapíšu naraz alebo vôbec.

## Čo tieto integračné testy nepredstierajú

Testy `server.test.ts` vkladajú identitu na hranici funkcie `handleRequest`, teda **samotná táto sada netestuje Better Auth OTP, cookies ani session**. Overuje autorizáciu aplikácie po prijatí overenej identity. Skutočné prihlásenie a session overuje samostatná sada `auth.test.ts` opísaná vyššie. SQLite testy nenahrádzajú migráciu a kontrolu produkčného databázového súboru ani prevádzkového zálohovania. Rozhranie adaptéra je kompatibilné s pôvodnou D1 vrstvou; finálny runtime používa SQLite.

Tvrdenie o zachovaní textu skriptu v JSON teste znamená iba to, že backend údaje neupraví na spustiteľnú odpoveď. Samotné bezpečné React vykreslenie a interakcie treba posúdiť aj v prehliadači.

Sady `gamification.test.ts` a `push.test.ts` overujú svoje samostatné moduly; aktuálne súhrnné výsledky poskytuje `npm test`. Výsledok emulácie/desktopového prehliadača nemožno označiť za test na fyzickom iPhone alebo Android zariadení. Reálne doručenie push a e-mailov vyžaduje konfiguráciu a skúšku príslušných externých služieb.
