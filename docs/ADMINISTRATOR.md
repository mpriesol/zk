# Sprievodca organizátora

## Prvé nasadenie aktualizácie

Bežné nasadenie zachová aktuálne účty, aktivity, fotografie aj dátumy prípravy. Známe testovacie názvy sa zmenia na **Cestou Zimy 2027**. Termín hlavnej časti sa doplní na **3.–7. februára 2027** podľa [zimnykurz.sk](https://zimnykurz.sk/). Prípravný víkend na Myjave je 15.–17. januára 2027; nejde o začiatok každodennej prípravy v appke.

Pred aktualizáciou vytvor overenú zálohu a priprav nový oddelený zálohovací adresár podľa [DEPLOYMENT.md](DEPLOYMENT.md). Samotné nahratie kódu ani migrácie nevyvolajú spustenie novej prípravy.

Administráciu otvor cez ponuku hore alebo bočný panel. Prepínač **Organizátor / Účastník** v hornej lište mení iba zobrazenie ovládacích prvkov; nemení prihlásený účet ani jeho serverové oprávnenia.

## Spustiť prípravu na zimný kurz

Funkcia je v **Administrácia → Rozšírené nastavenia**. Používa sa pri vedomom začatí nového obdobia, napríklad po skúšaní aplikácie alebo pre nový ročník.

1. Vyplň názov a ročník, **začiatok a koniec prípravy** a dátumy hlavnej časti kurzu. Dátumy sa zadávajú pre každý ročník samostatne.
2. Rozhodni o voľbe **Zachovať účastníkov a ich prihlásenie – pokračujeme s rovnakou skupinou**. Predvolene nie je zaškrtnutá: staré členstvá a výlučne lokálne účty sa odstránia.
3. Stlač **Zobraziť presný náhľad spustenia**. Tento krok nič nemaže. Uvidíš presné počty údajov, ktoré sa odstránia, aj zachovaných účtov a obrázkov.
4. Skontroluj upozornenie. Z aplikácie zmiznú doterajšie aktivity, reakcie, komentáre, fotografie aktivít, udelené odmeny, splnenia výziev, vločky, správy, adresáti, pozvánky a ďalšia história danej prípravy. Ak nezachováš účastníkov, odstránia sa aj ich členstvá a účty používané iba tu.
5. Označ kontrolné políčko a prepíš **SPUSTIŤ PRÍPRAVU**. Až posledné tlačidlo vykoná spustenie.

Pred vymazaním server vytvorí a overí úplnú zálohu databázy aj médií. Bez nej pokračovanie odmietne. Náhľad platí desať minút; po zmene údajov treba pripraviť nový. Tvoje aktuálne organizátorské prihlásenie a účty používané v inom kurze sa zachovajú. Pri zaškrtnutom zachovaní skupiny ostanú účastníkom aj avatary a prihlásenia.

Zostáva konfigurácia: typy pohybu, pravidlá, šablóny a obrázky ocenení, knižnica citátov. Výzvy sa pripravia ako **koncepty** s novým obdobím. Pred zverejnením ich skontroluj. Pre nové obdobie nemusíš kupovať ani znovu nahrávať vizuály odmien.

**Dôležité pri budúcom dátume:** potvrdenie odstráni starú históriu ihneď a nastaví zvolené obdobie. Pridávanie nových aktivít bude dostupné až od dátumu začiatku. Tlačidlo neplánuje budúci výmaz na pozadí.

## Výzva Studená sprcha alebo otužovanie

Výzva má samostatné záznamy, neovplyvňuje pohybové dni ani minúty. V administrácii ju zverejni, keď je pripravená. Účastníkom sa sprístupní najskôr v ôsmy deň prípravy, prípadne neskôr podľa nastaveného dňa a začiatku výzvy. Do tej doby sa jej skrytý obsah neposiela účastníckemu API.

Na Domove je zimná krajinka. Jedna dnešná vločka znamená jedného človeka s dnešným záznamom; súčasne vidno počet ľudí a súčet jedinečných dní človek × dátum za prípravu. V kalendári je malá vločka vedľa ikon bežných aktivít. Dve sprchy v jeden deň nevytvoria dve vločky. Druh je sprcha alebo otužovanie, bez merania výdrže či intenzity.

Skupina vidí dátumy a druh záznamu. Poznámku vidí iba jej autor a organizátor. Spätné doplnenie a oprava sú možné v platnom období aj po ukončení výzvy.

## Drahokam, symbol alebo vlastný obrázok

Pri základnom pravidle, výzve aj osobitnom ocenení vyber **Drahokam / Predmet alebo symbol / Vlastný obrázok**. Symboly majú voliteľnú farbu; obrázok môže byť JPEG, PNG alebo WebP do 10 MB. Server ho bezpečne zmenší a odstráni pôvodné metadáta. Vlastné obrázky sú dostupné iba oprávneným členom kurzu.

V sekcii **Osobitné ocenenia** je 13 upraviteľných návrhov. Prvých šesť praktických úloh si potvrdí účastník; osobné poďakovania udeľuje organizátor s konkrétnym dôvodom. Všetky sa najprv vytvoria ako **koncepty**, nezverejnia sa samy.

| Šablóna                                                                                                     | Typ                           |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------- |
| V rukaviciach, Stan stojí, Bez signálu, Zbalené, Opravené, Spolu vonku                                      | Dobrovoľné vlastné potvrdenie |
| Parťák, Čajový diplomat, Baterkový maják, Úsmev do batohu, Tichá pomoc, Pokojný prístav, Záchranca ponožiek | Udelenie organizátorom        |

Pri vlastnom potvrdení sa zaznamená deň a príbeh; pri organizačnom udelení dôvod. Získaná odmena si uchová pôvodný názov, podmienku aj vizuál. Zmena šablóny nemení spätne staré udelenia. Pôvodných päť pohybových pravidiel sa nemení; ich zmeny majú naďalej verzie a samostatný náhľad spätného prepočtu.

## Štatistiky a spravodlivé rozdelenie ocenení

V **Záverečných štatistikách** nastav dátumy a prípadné zahrnutie neaktívnych členstiev. Účastníci tieto porovnania nevidia; ich skupinový prehľad je abecedný.

- **Najviac:** 11 všeobecných kategórií, až tri na každý typ pohybu, jedna na druh základnej odmeny a dve na každý zastúpený mesiac. Príklady: pohybové dni, rôzne týždne, počet behov, minúty turistiky, získané smaragdy, mesačná pravidelnosť, fotky. Kategória sa objaví len pri kladných dátach.
- **Nominácie:** 16 základných možností, mesačné nominácie a prípadne pohyb v každom týždni vybraného obdobia. Každá má jasnú podmienku; nejde o tvrdenie, že jeden človek má najväčší výkon.
- **Ľudia v číslach:** súhrn po osobách vrátane dní, týždňov, minút, kilometrov, druhov pohybu, fotografií, odmien, praktických úloh a osobitnej evidencie dní otužovania.

Hravé nominácie zahŕňajú Víkendového yetiho, Pondelkového štartéra, Nedeľného tuláka, Majstra malých výprav (tri rôzne dni s pohybom 5–30 minút), Dvojitý život (pohyb po vlastných a cvičenie v rovnaký deň), Presného tridsiatnika a Časového dvojníka. Presné definície sú pri každej kategórii.

Zapni **Rozdeľ ocenenia medzi čo najviac ľudí**, označ vhodné kategórie a skontroluj návrh. Algoritmus maximalizuje počet rôznych ocenených, ale vyberá iba oprávnených kandidátov. Pri kategórii „najviac“ môže vybrať iba skutočné maximum alebo niekoho z remízy; druhé miesto neoznačí za víťaza. Návrh možno ručne upraviť a exportovať do CSV. Samotné ocenenia sa tým ešte neudeľujú; vytvor/zverejni zodpovedajúce osobné ocenenie a udeľ ho s dôvodom.

Časy a kilometre používajú iba vyplnené hodnoty. O chýbajúcich údajoch informuje súhrn. Rozhoduje dátum aktivity, nie hodina jej vloženia. Základné odmeny vstupujú do rozsahu podľa konca hodnoteného obdobia, osobné podľa dňa udelenia. Otužovanie má samostatné počty bez poradia výdrže. Komentáre a reakcie nevytvárajú odmeny.

## Denné citáty

V **Rozšírených nastaveniach** vyber začiatok zobrazovania a spravuj knižnicu citátov: text, autor, HTTPS zdroj, pôvodné znenie, dielo, poradie, aktívny stav a voliteľný interval. Katalóg začína ôsmimi krátkymi autentickými citátmi nájdenými cez [LibQuotes](https://libquotes.com/) a overenými podľa pomenovaných diel. Slovenské znenia sú označené ako vlastné preklady.

Citát je nad tlačidlom na Domove. Pre všetkých sa vyberie podľa miestneho dňa kurzu a uloží sa denná verzia. Obnovenie stránky citát nezmení; úpravy knižnice sa prejavia pri ďalšom výbere. Po poslednom vhodnom citáte sa poradie opakuje. Ďalšie citáty môžeš priebežne pridávať bez nového nasadenia.

## Správy, registrácie a používateľský návod

Nová registrácia bez platnej pozvánky vytvorí trvalé upozornenie pre aktuálnych administrátorov a pokus o push, ak ho majú zapnutý. Platná pozvánka nevytvára falošné čakanie. Klik vedie na príslušnú časť členov; už vybavená žiadosť ukáže svoj stav.

Archivovanie pripnutej správy je osobné. Keď účastník stlačí **Beriem na vedomie**, správa zmizne iba z jeho Domova a zostane v jeho archíve. Neprestane byť pripnutá ostatným.

Používateľ má **Ako na to** priamo v ponuke a tlačiteľný návod na `/navod.html` pod aktuálnym prefixom aplikácie. [Textová verzia](NAVOD_PRE_UCASTNIKOV.md) je pripravená na distribúciu. Aktuálna implementácia neobsahuje falošné screenshoty: nové prehliadačové snímky sú otvoreným overovacím bodom uvedeným v TESTING.md.
