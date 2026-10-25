# E-mailové prihlásenie a Node runtime

Aplikácia na vlastnom serveri používa **Better Auth 1.7 + emailOTP**, Node.js 24 a natívny `node:sqlite`. Účastník nepotrebuje účet ChatGPT. Prihlasovanie nie je prepínač ukážkových používateľov. Server overuje podpísanú session cookie a z nej získava identitu; žiadne používateľské identifikačné hlavičky z prehliadača nepovažuje za dôveryhodné.

## Správanie

1. Organizátor pridá e-mail do konkrétneho kurzu.
2. Používateľ si vyžiada šesťmiestny jednorazový kód. Platí 10 minút. Opätovné odoslanie vytvorí nový kód; použi posledný prijatý.
3. Better Auth kontroluje kód, vytvorí štandardný používateľský účet a session. Pred overením kódu znovu kontrolujeme aktívne členstvo. Verejná registrácia do kurzu neexistuje.
4. Session je uložená v SQL databáze. Cookie je `HttpOnly`, `SameSite=Lax`, má cestu podľa `APP_URL` (`Path=/zk` alebo `Path=/priprava`), v produkcii `Secure`; platnosť je 30 dní a obnovuje sa pri používaní po jednom dni. Obnovenie stránky nevyžaduje nový kód.
5. Každé aplikačné API volanie samostatne overí aktuálne členstvo a rolu. Odobratý člen preto stratí prístup aj s platnou session.
6. Odhlásenie revokuje serverovú session a vymaže cookie. Súkromné API odpovede používajú `Cache-Control: private, no-store`; service worker ich necachuje.

OTP je v databáze hashovaný štandardným mechanizmom Better Auth. Platný kód možno použiť iba raz, päť chybných pokusov ho zneplatní. Opatrenia proti opakovaným pokusom sú uložené v databáze: najviac 3 žiadosti o kód a 8 pokusov o prihlásenie z jednej IP za minútu. Neprihlásenej cudzej adrese neodošleme kód; odpoveď na žiadosť je všeobecná a neoznamuje zoznam účastníkov. Rozdiel času odosielania SMTP sa tým úplne nemaskuje.

Rozhranie zachová aktuálnu adresu aplikácie vrátane otvorenej správy; úspešné prihlásenie znovu načíta tú istú obrazovku. Chybové a expirované kódy nevytvárajú falošné úspešné hlásenie. Presmerovania na cudzie URL sa pri prihlasovaní nepoužívajú.

## Konfigurácia

| Premenná | Význam |
|---|---|
| `NODE_ENV` | Na vlastnom serveri `production` |
| `APP_URL` | Najprv `https://hub.biketrek.sk/zk`, neskôr `https://zimnykurz.sk/priprava`; rovnaká hodnota pre build aj runtime |
| `BETTER_AUTH_SECRET` | Náhodné tajomstvo, aspoň 32 znakov; nesmie byť v Gite |
| `DATABASE_PATH` | Cesta k SQLite súboru, v kontajneri napr. `/data/cestou-zimy.sqlite` |
| `COURSE_ID` | Samostatný identifikátor ročníka, predvolene `cestou-zimy` |
| `BOOTSTRAP_ADMIN_EMAIL` | E-mail prvého organizátora |
| `AUTH_MAIL_MODE` | `smtp` v produkcii; `file` je dostupné výhradne vo vývoji |
| `SMTP_HOST`, `SMTP_PORT` | Existujúci SMTP poskytovateľ, port predvolene 587 |
| `SMTP_SECURE` | `true` pre implicitné TLS, obvykle port 465; inak sa vyžaduje STARTTLS |
| `SMTP_USER`, `SMTP_PASSWORD` | Prihlásenie SMTP; pri vlastnom dôveryhodnom relayi môžu byť prázdne |
| `MAIL_FROM` | Overená odosielacia adresa, napr. `Cestou Zimy <info@example.sk>` |
| `HOST`, `PORT` | Predvolene `127.0.0.1:3000`; kontajner používa `0.0.0.0:3000` |
| `TRUST_PROXY` | `1` len ak aplikáciu možno dosiahnuť výhradne cez dôveryhodný Caddy, ktorý prepisuje `X-Real-IP` |
| `AUTH_TRUSTED_ORIGINS` | Voliteľné presné ďalšie dôveryhodné originy oddelené čiarkou; bežne nepoužívať |
| `MAIL_DIRECTORY` | Len vývoj: súkromný adresár súborových e-mailov, predvolene `.data/mail` |

Tajomstvo vytvor napríklad `openssl rand -base64 48` a vlož ho priamo do nezverejňovanej konfigurácie. Server v produkcii odmietne spustenie bez tajomstva, HTTPS adresy, SMTP servera alebo odosielateľa. Vývojový súborový mailbox sa v produkcii nedá zapnúť.

## Prvý organizátor

Pri štarte sa vykonajú schémové migrácie, ale nevytvára sa verejne použiteľný admin účet ani heslo. E-mail v `BOOTSTRAP_ADMIN_EMAIL` si vyžiada a overí skutočný OTP kód. Jeho prvé načítanie aplikačného `api/state` (najprv `/zk/api/state`) vytvorí testovací ročník a člena s rolou organizátora, **iba ak kurz ešte neexistuje**. Zhodu e-mailu overuje server. Potom organizátor upraví názov a dátumy a pozve ďalších členov. Po vytvorení môže prevádzkovateľ premennú odstrániť; existujúca rola sa zachová v databáze.

Zmena bootstrap e-mailu na existujúcom kurze nepridá ďalšieho admina. Roly ďalších členov spravuje už oprávnený organizátor. Odstránenie posledného aktívneho organizátora aplikačné API odmietne.

## Migrácie a proces

`server/sqlite.ts` poskytuje `SQLiteDatabase` pre rovnaký backend ako integračné testy. Používa WAL a atomické databázové dávky. `migrateApp` aplikuje SQL migrácie z `drizzle` v poradí a uloží ich kontrolné súčty do `__app_migrations`; už aplikovanú migráciu nemožno potichu prepísať. Schéma Better Auth sa pripravuje jeho oficiálnym `getMigrations(...).runMigrations()`.

`node --experimental-strip-types scripts/migrate.ts` vykoná iba migrácie. `server/start.ts` ich vykoná automaticky pred prijímaním požiadaviek. Na úplne prázdnej databáze môže Better Auth pri prvej inicializácii krátko vypísať chýbajúcu schému; nasledujúca migrácia ju vytvorí pred otvorením HTTP portu. Pri chybe migrácie sa server nespustí.

Produkčný runtime servíruje `dist/client`, API a štandardné auth endpointy pod cestou z `APP_URL`. Spočiatku prihlasovanie používa `/zk/api/auth`, aplikačné API `/zk/api/state` a `/zk/api/action`; po zmene konfigurácie sa všetko presunie pod `/priprava`. Hodnotu `APP_BASE_PATH` odvodzuje `lib/paths.ts` z rovnakej konfigurácie. Frontend dostane verejnú cestu pri zostavení cez `__CZ_BASE_PATH__`; nejde o ďalšiu samostatnú premennú prevádzkovateľa. Produkčný štart porovná `dist/client/build-config.json` s cestou servera a pri nesúlade odmietne spustenie. Manifest sa vždy generuje pre aktívnu cestu. Nezávislý interval každých 30 sekúnd spracúva trvalú frontu oznámení a pozvánok; zavretý adminov prehliadač spracovanie nezastaví. SMTP prijatie správy nie je potvrdenie prečítania ani garantovaného doručenia. Záznamy z fronty majú obmedzené opakovanie; pozvánky používajú stabilné `Message-ID`, no SMTP samotné neposkytuje presne-jednorazové doručenie pri havárii tesne po prijatí.

`GET /healthz` overí dostupnosť databázy bez účtu a vracia iba `{"ok":true}`. Pri vývoji sa používa React/Vite middleware. Pomocná `/__qa?width=390&height=844` (iframe smeruje na aktívnu cestu aplikácie) je dostupná iba mimo produkcie a zobrazuje aplikáciu v presnom rozmere na kontrolu responzívnosti; nejde o emuláciu Safari.

## Dve etapy nasadenia a presun bez zmeny kódu

**Prvá etapa:** `APP_URL=https://hub.biketrek.sk/zk`. Prehliadač navštevuje Hub a Caddy zachová `/zk` aj `Host: hub.biketrek.sk`. Cookie má `Path=/zk`. Ide o skutočnú aplikáciu s rovnakou databázou a oprávneniami, nie o samostatný demo frontend.

**Neskorší presun:** nastav `APP_URL=https://zimnykurz.sk/priprava`, znovu zostav frontend/kontajner s touto hodnotou a spusti ho s rovnakou hodnotou. Zachovaj databázový volume, `DATABASE_PATH`, `COURSE_ID` a `BETTER_AUTH_SECRET`. Vygeneruj príslušný variant Caddy konfigurácie podľa dokumentácie nasadenia. Kód sa neupravuje a existujúce aktivity, členovia, odmeny a správy zostávajú v databáze.

V druhej etape musí hosting pôvodného webu proxyovať `/priprava/` na `https://hub.biketrek.sk/zk/`. Caddy v tomto variante prepíše `/zk` na `/priprava` a backendu nastaví kanonický `Host: zimnykurz.sk`. Dostupnosť reverznej proxy na hostingu zimnykurz.sk treba overiť pred presunom. Origin pri POST ostáva skutočný verejný origin; ochrana CSRF a kontrola Host sa nevypínajú. Súčasne sa nepovoľujú dva verejné originy ako obchádzka.

Po zmene domény sa účastník znova prihlási OTP kódom. Prehliadač správne neprenesie cookies z Hubu na zimnykurz.sk. Push odbery sú tiež viazané na origin, preto treba na novej adrese upozornenia opätovne zapnúť a prípadne nahradiť starú ikonu PWA. Zmena `APP_URL` neprepisuje databázu. `appPath` vie zjednotiť uložené interné odkazy zo starej cesty na novú; nevytvára tým alternatívny HTTP vstup.

HTTP runtime akceptuje `/healthz` aj pre lokálnu Docker kontrolu, ostatné cesty kontrolujú Host. `/` presmeruje na aktívny koreň aplikácie. Endpointy mimo aktívneho prefixu vracajú 404. Podporované cesty `APP_URL` sú výhradne `/zk` a `/priprava` (voliteľne s koncovou lomkou); holý origin, iná cesta, prihlasovacie údaje v URL, query alebo fragment neprejdú validáciou. Pred štartom sa overí zhodná cesta frontend buildu a servera, aby po prepnutí nevznikol rozbitý mix starých assetov a nových endpointov.

## Vývoj a testovanie bez SMTP

Vo vývoji je verejná cesta rovnaká, napr. `APP_URL=http://localhost:3000/zk` alebo `http://localhost:3000/priprava`. Možno nastaviť `AUTH_MAIL_MODE=file`. Kódy sú potom v súkromných JSON súboroch adresára `MAIL_DIRECTORY` s oprávnením 0600 (adresár 0700). Neobjavujú sa v API odpovedi ani v klientskom JavaScripte. Súkromný mailbox je iba lokálny vývojový nástroj a neoveruje doručenie do reálnej schránky. Ak nie je nastavené vývojové tajomstvo, vytvorí sa náhodné trvalé tajomstvo v `.data/auth-secret` s oprávnením 0600.

`node --experimental-strip-types --test tests/auth.test.ts` skutočne vykonáva HTTP-kompatibilné Better Auth handlery, vytvorenie kódu, overenie, session cookie, expiráciu, počet pokusov, limity, odhlásenie, odobraté členstvo, cudzie originy, podvrhnuté hlavičky a opätovné otvorenie databázy. Ďalšie testy vykonávajú OTP prihlásenie v oboch režimoch na rovnakej databáze, kontrolujú cestu a Secure príznak cookie, zachovanie členstva po presune, odmietnutie neaktívnej HTTP cesty a nesúlad buildu s runtime konfiguráciou. Mail je v testoch zachytený súkromnou testovacou funkciou; žiadny kód nie je napevno nastavený. Produkčné SMTP, DNS/SPF/DKIM a doručenie do schránok účastníkov vyžadujú samostatné prevádzkové overenie.

## Oficiálne technické podklady

- [Better Auth: SQLite vrátane Node DatabaseSync](https://better-auth.com/docs/adapters/sqlite)
- [Better Auth: email OTP](https://better-auth.com/docs/plugins/email-otp)
- [Better Auth: schéma a programové migrácie](https://better-auth.com/docs/concepts/database)
- [Better Auth: limity požiadaviek a dôveryhodné proxy](https://better-auth.com/docs/concepts/rate-limit)
- [Better Auth: konfigurácia originu a cookies](https://better-auth.com/docs/reference/options)

Overené pri implementácii 25. 10. 2026. Presnú inštalovanú verziu a transitive závislosti uzamyká lockfile.
