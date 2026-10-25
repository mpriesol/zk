# Produkt v1

Jeden aktuálny kurz s identifikátorom `COURSE_ID`, dospelí pozvaní účastníci a organizátori. Účet možno vytvoriť prezývkou a heslom bez e-mailu. Meno a priezvisko sú nepovinné a súkromné; ostatní účastníci vidia iba prezývku. Platný pozývací odkaz umožní vstup, inak nová registrácia čaká na schválenie organizátorom. SMTP/e-mailový kód ostáva voliteľný spôsob prihlásenia. Každé API kontroluje aktívne členstvo; session odobratého člena nezabezpečí prístup. Ostatní členovia vidia prezývku, nie e-mail. Súhrny sú záznamy dobrovoľnej aktivity, nikdy zdravotné skóre alebo dôkaz neaktivity.

## Obrazovky

- **Domov**: rýchly zápis, vlastný týždenný súhrn, odmeny, výzvy, pripnutá správa, feed.
- **Všetci**: abecedná skupina, týždenná matica na desktope a kompaktné dni na mobile; detail dňa/človeka, spoločné grafy.
- **Výzvy**: podmienky, progres a započítané záznamy; základné drahokamy a samostatné zverejnené ad-hoc výzvy. Manuálne úlohy nepotrebujú schvaľovanie inštruktorom.
- **Ja**: prezývka, osobné grafy, história a kalendár, zbierka, vypnutie animácií a dobrovoľný push.
- **Správy**: vlastná história, neprečítané a individuálny stav prečítania.
- **Administrácia**: členovia/pozvánky/roly, obdobie, typy, verzované pravidlá, výzvy, správy, audit a CSV kurzových dát (aktivity, členovia, odmeny, výzvy, splnenia, oznámenia, adresáti, komentáre a reakcie). Organizátor môže prepínať bežné zobrazenie; serverové oprávnenia ostávajú.

## Dáta a súkromie

Povinné sú typ a deň aktivity. Trvanie, kilometre a poznámka sú voliteľné. Dátum aktivity je miestny kalendárny deň kurzu; createdAt/updatedAt sú oddelené UTC časy. Týždeň je pondelok–nedeľa. Dve aktivity v jednom dni sú dva zápisy, ale jeden pohybový deň. Neznáme trvanie ostáva null a nesplní časový limit. Server nepovolí budúce dokončené aktivity ani dátumy mimo prípravy. Idempotency key chráni nový zápis pred opakovaným requestom.

Texty sa zobrazujú ako React text, nikdy HTML. Používateľ môže meniť svoje komentáre a aktivity; organizátor môže odstrániť nevhodný obsah s auditom. Žiadne odmeny za lajky alebo komentáre.

Studená sprcha a noc vonku sú serverové skryté koncepty. Neodchádzajú účastníkovi v API, počítadlách, grafoch ani klientskom seede. Publikovanie naraz odhalí výzvu a jej úlohu; druhá ostáva skrytá. Úlohy sa nezapočítavajú do tréningových minút ani pohybových dní.

Nový člen dostane **iba oznámenia odoslané po jeho pridaní**. Žiadne automatické sprístupnenie starých hromadných ani cielených správ. Adresáti sa pri odoslaní trvalo uložia. Opakované odoslanie toho istého konceptu nevytvorí druhú správu ani druhé push úlohy. Neskoršia úprava textu nový push neodošle.

## Odmeny a zmeny

Päť odmien: **Pravidelnosť, Pohyb, Sila, Pestrosť, Výbava**. Presné pravidlá v GAMIFICATION.md a pri každej odmene. Neprítomnosť nič neodoberá. Oprava chybného záznamu však nárok prepočíta. Týždenná zmena parametrov platí od ďalšieho pondelka; celokurzová až po aktuálnom období. Spätný prepočet vyžaduje samostatný, časovo obmedzený náhľad a potvrdenie; zmena dát náhľad zneplatní. Po prvých záznamoch nemožno posúvať začiatok prípravy bez migrácie.

## PWA, výpadky a veverička

Manifest a service worker podporujú inštaláciu a dobrovoľný push. Service worker necachuje súkromné API ani neimplementuje offline synchronizáciu. Neúspešné uloženie zachová formulár; úspech sa ukáže až po odpovedi servera. Odhlásenie vyprázdni React stav a zruší push aktuálneho zariadenia. Doručenie push poskytovateľovi nie je prečítanie ani garancia doručenia.

Originálna ilustrácia má skrytý a vykuknutý stav. Automatické vystúpenia sa obmedzujú na dve za reláciu (nastaviteľné), pamätajú si udalosti medzi reloadmi a nepreberajú focus. Pri formulári/písaní sa schová. Reduced motion a osobné vypnutie animácií sú rešpektované; všetky správy/odmeny existujú aj v normálnom rozhraní.

## Hranice

Bez GPS/Strava, AI trénera, fyzickej pripravenosti v percentách, rebríčka, povinných sérií, pokút, meny, obchodu, mapy, pasu/pečiatok, chatu, rodiniek, fotiek či platieb. Dobrovoľné e-mailové novinky nie sú implementované; v UI nemajú nefunkčný prepínač. Jednorazový prihlasovací kód a pozvánky sú transakčné e-maily.
