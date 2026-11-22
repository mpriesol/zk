# Produkt — príprava od ročníka 2027

Jeden aktuálny kurz s identifikátorom `COURSE_ID`, dospelí pozvaní účastníci a organizátori. Účet možno vytvoriť prezývkou a heslom bez e-mailu. Meno a priezvisko sú nepovinné a súkromné; ostatní účastníci vidia iba prezývku. Platný pozývací odkaz umožní vstup, inak nová registrácia čaká na schválenie organizátorom. SMTP/e-mailový kód ostáva voliteľný spôsob prihlásenia. Každé API kontroluje aktívne členstvo; session odobratého člena nezabezpečí prístup. Ostatní členovia vidia prezývku, nie e-mail. Súhrny sú záznamy dobrovoľnej aktivity, nikdy zdravotné skóre alebo dôkaz neaktivity.

## Obrazovky

Hlavná navigácia (od 22. 11. 2026) má päť stále viditeľných položiek: **Spolu · Prehľad · + · Výzvy · Ja**. Správy sú pod zvončekom, administrácia v Ja a v bočnom paneli na desktope. Staré odkazy `?view=home|group|challenges|me` sa presmerujú na nové obrazovky.

- **Spolu:** pruh dôležitej správy, karta Dnes v skupine (ľudia, aktivity podľa typu, kto zapísal, otužovanie zvlášť, zapojenie v týždni), denné motto a chronologický feed po dňoch s podporou, komentármi a filtrom.
- **Prehľad:** týždeň alebo mesiac po ľuďoch, abecedne; detail dňa/človeka, zimná krajina otužovania a spoločné štatistiky. Voľby sa pamätajú pre aktuálneho člena.
- **+ / Nový zápis:** spodný panel s mriežkou typov, Dnes/Včera/Iný deň, trvanie min/hod, fotografie a samostatný riadok pre vločku.
- **Výzvy:** drahokamy týždňa a prípravy s detailom pravidiel, osobné ocenenia, výzvy organizátorov a zbierka.
- **Ja:** vlastný týždeň/mesiac, kalendár, štatistiky, vlastné zápisy, profil, upozornenia, heslo, návod, administrácia a odhlásenie.
- **Výzvy a odmeny:** päť pôvodných drahokamov, presné podmienky a započítané záznamy, publikované výzvy, praktické odznaky, osobné ocenenia a história odmien.
- **Profil a nastavenia:** prezývka, fotografia s výrezom, heslo, animácie medvedíka/osláv, dobrovoľný push a odhlásenie. Pôvodný tab Ja sa nepoužíva.
- **Správy:** vlastné doručené správy a osobný archív. Potvrdenie pripnutej správy ju skryje len aktuálnemu človeku.
- **Administrácia:** členovia/pozvánky, termíny, typy, verzované pravidlá, vizuály, výzvy, osobné ocenenia, citáty, správy, štatistiky/nominácie, audit, CSV a samostatný potvrdený štart novej prípravy. Prepínač účastníckeho zobrazenia je hore; serverové oprávnenia sa nemenia.

## Dáta a súkromie

Povinné sú typ a deň aktivity. Trvanie, kilometre a poznámka sú voliteľné. Dátum aktivity je miestny kalendárny deň kurzu; createdAt/updatedAt sú oddelené UTC časy. Týždeň je pondelok–nedeľa. Dve aktivity v jednom dni sú dva zápisy, ale jeden pohybový deň. Neznáme trvanie ostáva null a nesplní časový limit. Server nepovolí budúce dokončené aktivity ani dátumy mimo prípravy. Idempotency key chráni nový zápis pred opakovaným requestom.

Texty sa zobrazujú ako React text, nikdy HTML. Používateľ môže meniť svoje komentáre a aktivity; organizátor môže odstrániť nevhodný obsah s auditom. Žiadne odmeny za lajky alebo komentáre.

Studená sprcha alebo otužovanie a noc vonku začínajú ako skryté koncepty. Otužovanie má navyše odomknutie najskôr od ôsmeho dňa prípravy a samostatnú tabuľku. Po zverejnení a odomknutí vzniká najviac jedna vločka na člena/deň; skupina vidí dátum/druh a súhrny, poznámku iba autor a organizátor. Otužovanie ani iné úlohy nevytvárajú pohybové dni/minúty. Skryté koncepty sa neposielajú v účastníckom API, grafoch, obrázkoch ani oznámeniach.

Fotografie aktivity (najviac päť, vstup do 10 MB) a samostatné avatary sa overujú, dekódujú a preukladajú bez EXIF/GPS. JPEG/PNG/WebP sa zmenšia do 2048 px, avatar má výrez do 512 px. Prístup kontroluje kurz a členstvo; nemožno verejne čítať médium iba znalosťou jeho ID. Nové fotky sa najprv nahrávajú súkromne; pripojenie k aktivite je atómové. Cleanup po nejasnom výsledku uloženia nesmie odstrániť už priradenú fotografiu.

Nový člen dostane **iba oznámenia odoslané po jeho pridaní**. Žiadne automatické sprístupnenie starých hromadných ani cielených správ. Adresáti sa pri odoslaní trvalo uložia. Opakované odoslanie toho istého konceptu nevytvorí druhú správu ani druhé push úlohy. Neskoršia úprava textu nový push neodošle.

## Odmeny a zmeny

Päť odmien: **Pravidelnosť, Pohyb, Sila, Pestrosť, Výbava**. Presné pravidlá v GAMIFICATION.md a pri každej odmene. Neprítomnosť nič neodoberá. Oprava chybného záznamu však nárok prepočíta. Týždenná zmena parametrov platí od ďalšieho pondelka; celokurzová až po aktuálnom období. Spätný prepočet vyžaduje samostatný, časovo obmedzený náhľad a potvrdenie; zmena dát náhľad zneplatní. Po prvých záznamoch nemožno posúvať začiatok prípravy bez migrácie.

## Osobné ocenenia, denné mottá a ročníky

Odmena môže byť drahokam, symbol s farbou alebo autorizovaný vlastný obrázok. Praktické vlastné potvrdenia a organizačné poďakovania majú vlastné podmienky a snapshoty; 13 východiskových šablón je najprv draft. Administrátorské maximá a nominácie majú presné definície, remízy a rozdelenie medzi oprávnených kandidátov. Verejný rebríček nevzniká.

Osem východiskových mott má doloženého autora/dielo, zdroj a označený slovenský preklad. Denný výber sa riadi časovým pásmom kurzu, poradie a interval upraví admin. Už zobrazený citát je pre celý miestny deň stabilný.

Ročník, príprava a hlavná udalosť majú samostatné dátumy. Existujúca príprava sa aktualizáciou nemaže. Nový štart má presný desaťminútový náhľad, explicitné potvrdenie a povinnú úplnú zálohu. Zachová prihlásenie konajúceho organizátora, účty iných kurzov a konfiguráciu; voliteľne členov rovnakej skupiny. Výmaz dát a zmena obdobia sú jedna transakcia. Pozri ADMINISTRATOR.md.

## PWA, výpadky a medvedík

Manifest a service worker podporujú inštaláciu a dobrovoľný push. Service worker necachuje súkromné API ani neimplementuje offline synchronizáciu. Neúspešné uloženie zachová formulár; úspech sa ukáže až po odpovedi servera. Odhlásenie vyprázdni React stav a zruší push aktuálneho zariadenia. Doručenie push poskytovateľovi nie je prečítanie ani garancia doručenia.

Originálna ilustrácia má skrytý a vykuknutý stav. Automatické vystúpenia sa obmedzujú na dve za reláciu (nastaviteľné), pamätajú si udalosti medzi reloadmi a nepreberajú focus. Pri formulári/písaní sa schová. Reduced motion a osobné vypnutie animácií sú rešpektované; všetky správy/odmeny existujú aj v normálnom rozhraní.

## Hranice

Bez GPS/Strava integrácie, AI trénera, fyzickej pripravenosti v percentách, verejného rebríčka, povinných sérií, pokút, meny, obchodu, mapy, pasu, chatu, rodiniek či platieb. Administrátorské štatistiky a súkromné fotografie sú povolené rozšírenie; nezakladajú zdravotné skóre. Dobrovoľné e-mailové novinky nie sú implementované; v UI nemajú nefunkčný prepínač. Jednorazový prihlasovací kód a pozvánky sú transakčné e-maily.
