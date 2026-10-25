# Gamifikácia v1

Výpočty sú v `lib/gamification.ts`, kalendárne pomocné funkcie v `lib/dates.ts`. UI nerozhoduje o nároku. Pravidlá sú uložené ako verziované serverové dáta a pri udelení má odmena snapshot pravidla. Účastník nemusí behať, mať platené športovisko ani nakupovať výbavu.

## Základná zbierka

| Odmena | Podmienka v1 | Obdobie a limit | Čím sa odlišuje |
|---|---|---|---|
| Pravidelnosť · krištáľ | 3 rôzne dni so zaznamenaným pohybom | Raz za týždeň, pondelok–nedeľa | Pravidelnosť, bez dennej série; ľubovoľný pohyb |
| Pohyb · smaragd | 2 prechádzky, túry alebo behy, každá aspoň 30 minút | Raz za týždeň | Jediná športová odmena za pohyb po vlastných; bez hornej hranice trvania |
| Sila · jantár | 2 cvičenia, každé aspoň 15 minút | Raz za týždeň | Doplnkové cvičenie; stačí domáce cvičenie s vlastnou váhou alebo mobilita |
| Pestrosť · ametyst | 3 pohyby po vlastných ≥30 min a 3 cvičenia ≥15 min | Raz za celú prípravu | Kombinácia dvoch odlišných oblastí, nie druhá odmena za dlhšiu túru |
| Výbava · zafír | Skontrolovať zoznam, vrstvy oblečenia a plán doplnenia alebo požičania chýbajúcich vecí; dobrovoľne potvrdiť | Raz za celú prípravu | Praktická príprava; bez povinného nákupu a bez súvisu s tajnými bonusmi |

Tri týždenné odmeny možno získať aj v neúplnom okrajovom týždni prípravy, ale ich podmienky sa automaticky neznižujú. Každé obdobie je nezávislé. Prázdny týždeň nevymaže staršie odmeny ani nenuluje dlhodobú Pestrosť. Prázdny denník znamená **bez zápisu**, nie bez pohybu.

Pravidlá neudeľujú body, menu, poradie, percento fyzickej pripravenosti, pečiatky ani expedičný pas. Nehodnotia komentáre, reakcie ani GPS dôkazy. Bonusové skryté úlohy sú mimo základnej zbierky. Administrácia zachováva rozdiel medzi praktickou Výbavou (kľúč `equipment`, manuálne potvrdenie) a ostatnými základnými odmenami (iba pohybové podmienky). Jednoduché kombinácie ad-hoc výziev môžu obsahovať aj manuálnu časť; jej potvrdenie a poznámka sa uchovávajú oddelene od celkového splnenia.

## Prekryvy a vysvetlenie progresu

Jedna túra je jedna aktivita a môže prispieť k jednému pohybovému dňu. Patrí do jednej konkrétnej športovej skupiny `foot`. Jej trvanie nemôže zároveň splniť inú „dlhú“ športovú odmenu, pretože taká odmena neexistuje. Prispieva aj do všeobecnej pravidelnosti a do jednej polovice dlhodobej kombinácie Pestrosť; túru však nikdy nepovažujeme za domáce cvičenie.

Záznamy sa nemíňajú ani ručne nepriraďujú k misiám. Predĺženie vhodnej aktivity z 30 na 90 alebo 240 minút zachová rovnaký progres. Dve reálne aktivity v rovnaký deň sú dva záznamy, ale iba jeden pohybový deň. Obe môžu prispieť do odmeny založenej na počte aktivít; Pravidelnosť stále vyžaduje tri rôzne dni.

Každý výsledok obsahuje `explanation`, `countedActivityIds` a `missing`. Kombinácia navyše vracia jednotlivé `parts`. Počítadlo odmeny sa zastaví na cieli; zaznamenané aktivity a grafy si ponechajú skutočné počty. Neznáme trvanie je `null`, nie nula. Taký záznam sa počíta ako pohybový deň, ale nesplní časovú podmienku. Úlohy skupiny `task` nevytvárajú pohybové dni ani minúty, a to ani pri chybnom vstupe s vyplneným trvaním.

## Obdobia, verzie a opravy

Dátum aktivity je samostatné ISO pole `YYYY-MM-DD`. O výpočte rozhoduje tento dátum, nie `createdAt`. Nedeľná aktivita dopísaná v pondelok patrí do končiaceho týždňa. Výpočty kalendárnych dní používajú UTC aritmetiku a predvolený dnešný deň sa odvodzuje z `Europe/Bratislava`; zmena letného času neposúva dni. Hranice prípravy aj výziev sú **vrátane koncového dňa**.

Čistá funkcia `evaluateRule` vráti výsledky jednej verzie pre všetky týždne od začiatku prípravy do dneška, prípadne pre celé prípravné obdobie. Server vyberá príslušnú verziu a vykonáva databázové upsert/delete odmien. Kalendárnym identifikátorom týždňa je pondelok aj v neúplnom prvom týždni. Server má na výber verzie použiť neskorší z dátumov pondelka a začiatku prípravy.

Bežná zmena pravidiel platí do budúcnosti: týždenné pravidlá od ďalšieho pondelka. Už začaté celokurzové obdobie ponecháva svoju pôvodnú verziu. Úprava starého záznamu používa verziu platnú v jeho pôvodnom období; presun dátumu medzi týždňami prepočíta obe dotknuté obdobia. Ak oprava alebo zmazanie záznamu odstráni splnenie podmienky, zodpovedajúca odmena sa opraví. To je oprava údajov, nie trest za neaktivitu.

Spätná zmena pravidla je samostatná administrátorská operácia s náhľadom počtu aj konkrétnych období pridaných, odobratých a prepočítaných odmien. Aj keď ostane celkový počet rovnaký, náhľad ukáže presun medzi týždňami. Vyžaduje následné výslovné potvrdenie a auditný záznam; nová verzia, odmeny, audit a spotrebovanie náhľadu sa zapíšu v jednej atómovej transakcii. Náhľad platí desať minút a zmeny dát, pravidiel, nastavenia kurzu alebo kalendárneho dňa ho zneplatnia. Nie je úlohou čistej výpočtovej funkcie potichu vyberať najnovšiu verziu. Databázová vrstva musí zamedziť duplicitám kombinácie člen + pravidlo + obdobie.

## Bonusové výzvy a ukončenie

Bonusová odmena je odvodená z aktuálneho splnenia podmienok zverejnenej výzvy a zobrazuje sa pri tejto výzve. Podmienky publikovanej výzvy sa nemenia; po oprave alebo vymazaní podkladového zápisu sa bonusový stav prepočíta. Bonusy nevstupujú do základnej zbierky ani jej počítadla `awards` a samostatne nespúšťajú oslavu veveričky. Manuálne potvrdenia a ich poznámky sú trvalo uložené; automatické podmienky sa vypočítajú z trvalých aktivít.

Manuálne ukončenie skracuje obdobie na aktuálny deň v časovej zóne kurzu **vrátane**. Spätný zápis v tomto uzavretom období ostáva povolený a chybné vlastné potvrdenie možno odstrániť aj neskôr. Pri zrušení pred plánovaným začiatkom je obdobie prázdne a nevznikne progres ani odmena. Ukončenú výzvu nemožno znovu otvoriť; organizátor vytvorí novú výzvu. Ukončenie je výslovná auditovaná administrátorská zmena, nie tichá úprava pravidla.

## Štyri modelové prípady

| Prípad | Výsledok |
|---|---|
| Nebežec: tri 30-minútové prechádzky a tri 15-minútové domáce cvičenia v aspoň troch dňoch; kontrola výbavy | Dostupných všetkých päť základných odmien bez behu a plateného vybavenia |
| Tri 90-minútové behy v troch dňoch týždňa | Pravidelnosť a Pohyb; žiadna druhá odmena za dlhý beh, bez cvičenia nevznikne Sila ani Pestrosť |
| Pohyb v prvom týždni, druhý bez zápisu, návrat v treťom | Prvý týždeň ostáva splnený; tretí môže byť splnený nezávisle; žiadny reset alebo trest |
| Jediná 240-minútová sobotná túra | Pravidelnosť 1/3; Pohyb 1/2; Sila 0/2; jedna časť Pestrosti 1/3; žiadne dvojité športové odmeny |

## Rozhranie a overenie

- `defaultRules(startDate): Rule[]` – počiatočné serverové pravidlá; bez skrytých názvov a bonusových konfigurácií.
- `evaluateCondition(condition, activities, manualCount = 0): Progress` – typované podmienky dní, aktivít s minimom, kombinácie a manuálne potvrdenie.
- `evaluateRule(rule, activities, course, today, manualCount = 0): RuleProgress[]` – periódy a výpočty; volajúci filtruje člena, vyberá verziu a vykonáva trvalé udelenie.
- `summarize(activities): Summary` – spoločná definícia pre osobné aj skupinové súhrny. Skupinové pohybové dni sú súčet **osobodní** (člen + deň), nie iba počet kalendárnych dátumov. Neznáme minúty ostávajú označené a nie sú doplnené nulou.
- `weekStart`, `addDays`, `todayInZone`, `periodWeeks`, `validDate` – kalendárne operácie.

Unit testy: `node --experimental-strip-types --test tests/gamification.test.ts`. Pokrývajú štyri modelové prípady, monotónnosť trvania, duplicity query riadkov, dve aktivity za deň, chýbajúci čas, oddelené úlohy, spätný nedeľný zápis, presun dátumu, hranice kurzu, cudzie kurzy, osobodni, zmenu času a prázdne dáta. Testy autorizácie, perzistentného udeľovania, skrytých údajov a administrátorských verzií patria do integračnej sady backendu.
