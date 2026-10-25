# Účty, prihlasovanie a Node runtime

Aplikácia používa Better Auth, Node.js 24 a SQLite. Predvolené prihlásenie je **používateľské meno a heslo**, bez e-mailu a bez SMTP. E-mailový jednorazový kód zostáva voliteľným spôsobom prihlásenia. Účastník nepotrebuje účet ChatGPT. Server získava identitu zo session; používateľské identifikačné hlavičky z prehliadača nepovažuje za dôveryhodné.

## Používateľské meno a heslo

Povinné údaje pri registrácii sú prezývka (používateľské meno) a heslo. Celé meno je voliteľné a súkromné; ostatní účastníci vidia iba prezývku. Heslo má 10 až 128 znakov. Meno má 3 až 32 znakov; povoľujú sa písmená, čísla, medzery a znaky `._-`. Pri porovnávaní sa meno normalizuje a nerozlišuje veľké a malé písmená. Heslo sa ukladá prostredníctvom Better Auth ako hash, nie ako čitateľný text; aplikácia nemá vlastný algoritmus hashovania.

Registrácia nevytvára organizátora. S platnou pozvánkou sa nový účastník aktivuje; bez pozvánky čaká na schválenie organizátorom. Pozvánka má predvolene platnosť 7 dní a limit 30 použití. Organizátor môže zvoliť 1 až 30 dní a 1 až 100 použití alebo ju zrušiť. Limit jedného použitia je vhodný pre osobnú pozvánku. Schválenie členstva a roly kontroluje server pri každom aplikačnom API volaní, takže samotný vytvorený účet alebo platná session neposkytuje prístup do kurzu. Odobratý člen stratí prístup aj so starou session.

Organizátor môže v administrácii vystaviť jednorazový odkaz na nastavenie nového hesla. Platí 20 minút, nevyžaduje SMTP a treba ho odovzdať konkrétnemu používateľovi súkromne. Úspešná zmena hesla zruší jeho doterajšie session. Organizátor pôvodné heslo nevidí a nevytvára používateľovi zdieľané univerzálne heslo.

## Trvalé prihlásenie na PC a mobile

Session je v SQL databáze a cookie má `HttpOnly`, `SameSite=Lax`, cestu podľa `APP_URL` (`/zk`, `/priprava` alebo `/` na samostatnej subdoméne) a v produkcii `Secure`. Platnosť je 30 dní; pri používaní sa obnovuje po jednom dni. Obnovenie stránky alebo bežné opätovné otvorenie prehliadača nevyžaduje nové prihlásenie. PC a mobil môžu mať samostatné session. Súkromný režim prehliadača, zmazanie cookies, odhlásenie, zmena hesla alebo uplynutie relácie si vyžiada nové prihlásenie.

Odhlásenie zruší serverovú session a cookie daného zariadenia. Súkromné API odpovede majú `Cache-Control: private, no-store`; service worker ich necachuje. Po prihlásení sa zachová aktuálna adresa aplikácie vrátane otvorenej správy. Ochrana Origin a kontrola Host ostávajú zapnuté.

## Prvý organizátor bez SMTP

Prvý organizátor sa vytvára **iba explicitným príkazom na serveri**, nie verejnou registráciou ani rozhodnutím „prvý registrovaný je admin“. Po spustení ZK kontajnera:

```sh
cd /opt/cestou-zimy
docker compose --env-file zk.env -p cestou-zimy exec -it zk-app node --experimental-strip-types scripts/create-admin.ts
```

Príkaz si interaktívne vypýta používateľské meno, heslo a jeho potvrdenie. Heslo sa pri písaní nezobrazuje; neprijíma sa v argumente ani premennej prostredia a nevypíše sa do výsledku. Príkaz používa Better Auth na vytvorenie účtu a vytvorí prvý kurz s členstvom organizátora. Na už existujúcom kurze alebo pri existujúcom organizátorovi sa bootstrap odmietne. Existujúce účty ani role sa týmto príkazom neprepisujú.

Pre lokálny vývoj použi rovnaký skript s `node --env-file=.env --experimental-strip-types scripts/create-admin.ts`. Neinteraktívny vstup je povolený iba izolovaným automatickým testom s `NODE_ENV=test`; prevádzkovateľ používa terminál. Ak pri vytváraní prvého organizátora nastavíš `BOOTSTRAP_ADMIN_EMAIL`, jeho heslový účet dostane aj túto súkromnú adresu pre neskoršie voliteľné e-mailové prihlásenie. Bez nej sa prvý admin vytvorí bez požiadavky na e-mail. Samotné nastavenie adresy pri CLI nie je skúškou SMTP doručenia. Po prvom prihlásení nastav názov a dátumy kurzu a vytvor pozvánky alebo schváľ čakajúcich členov. Pri rušení rolí server chráni posledného aktívneho organizátora.

## Konfigurácia spôsobu prihlásenia

| Premenná | Význam |
|---|---|
| `AUTH_MODE` | `password` (predvolené): meno a heslo; `email`: iba e-mailový OTP; `both`: obe možnosti |
| `NODE_ENV` | Na vlastnom serveri `production` |
| `APP_URL` | Najprv `https://hub.biketrek.sk/zk`, neskôr prednostne `https://priprava.zimnykurz.sk`; podporované aj `https://zimnykurz.sk/priprava`; rovnaká hodnota pre build aj runtime |
| `BETTER_AUTH_SECRET` | Náhodné tajomstvo aspoň 32 znakov; nepatrí do Git a nemá sa meniť pri reštarte |
| `DATABASE_PATH` | SQLite súbor; v Docker volume `/data/cestou-zimy.sqlite` |
| `COURSE_ID` | Identifikátor ročníka; predvolene `cestou-zimy`; pri aktualizácii zachovať |
| `BOOTSTRAP_ADMIN_EMAIL` | Voliteľná súkromná adresa prvého organizátora vytvoreného cez CLI; zároveň bootstrap adresa v e-mailovom režime. Bežná heslová registrácia ju nepoužíva. |
| `REGISTRATION_OPEN` | Predvolene otvorené; hodnota `false` zastaví vytváranie nových heslových účtov aj cez pozvánku, existujúce účty sa môžu prihlasovať |
| `AUTH_MAIL_MODE` | `smtp` pre produkčné e-maily; `file` iba vo vývoji |
| `SMTP_HOST`, `SMTP_PORT` | Existujúci SMTP poskytovateľ; port predvolene 587 |
| `SMTP_SECURE` | `true` pre implicitné TLS (obvykle 465); inak sa vyžaduje STARTTLS |
| `SMTP_USER`, `SMTP_PASSWORD` | SMTP prihlasovanie; prázdne iba pri zámerne nakonfigurovanom dôveryhodnom relayi |
| `MAIL_FROM` | Povolená odosielacia adresa, napr. `Cestou Zimy <info@example.sk>` |
| `HOST`, `PORT` | Kontajner používa `0.0.0.0:3000` bez verejne publikovaného portu |
| `TRUST_PROXY` | `1` iba za dôveryhodným Caddy, ktorý prepisuje `X-Real-IP` |
| `AUTH_TRUSTED_ORIGINS` | Voliteľné presné ďalšie dôveryhodné originy; bežne nepoužívať |
| `MAIL_DIRECTORY` | Len vývoj: súkromný súborový mailbox, predvolene `.data/mail` |

Produkčný štart vyžaduje HTTPS adresu a tajomstvo. `AUTH_MODE=password` nepotrebuje SMTP. Režimy `email` a `both` v produkcii vyžadujú SMTP server aj povolený `MAIL_FROM`; vývojový súborový mailbox nie je produkčnou náhradou. Pre e-maily je možné použiť existujúceho SMTP poskytovateľa; inštalácia samostatného mailového servera na Hube nie je podmienkou aplikácie.

Po zmene `AUTH_MODE` alebo SMTP údajov v `zk.env` obnov iba ZK kontajner. Pri rovnakej URL netreba rebuild:

```sh
docker compose --env-file zk.env -p cestou-zimy up -d --no-deps --force-recreate zk-app
```

Samotný `restart` nové hodnoty z `zk.env` nenačíta. Zmena spôsobu prihlásenia nie je nástrojom na pridelenie ďalších rolí ani na zmazanie kurzu.

## Voliteľné e-mailové prihlásenie

V režime `email` alebo `both` organizátor pridá e-mail do kurzu. Účastník si vyžiada šesťmiestny kód, ktorý platí 10 minút. Opätovné odoslanie vytvorí nový kód; platí najnovší. Better Auth kontroluje kód, vytvorí účet a session; server pred overením znovu kontroluje členstvo. OTP je v databáze hashovaný. Platný kód možno použiť raz a päť chybných pokusov ho zneplatní. Limity žiadostí o kód a prihlásení sa uchovávajú v databáze. Odpoveď na žiadosť neprezrádza členstvo cudzej adresy.

Pri prvotnom e-mailovom bootstrape sa použije `BOOTSTRAP_ADMIN_EMAIL`: oprávnený účet musí overiť OTP zo skutočnej schránky a kurz ešte nesmie existovať. Zmena tejto premennej na existujúcom kurze nepridáva nového organizátora. Po vytvorení admina ju možno odstrániť. SMTP prijatie správy nie je potvrdenie prečítania ani garantovaného doručenia. Reálne doručenie a správnu konfiguráciu odosielateľa treba overiť samostatne.

## Migrácie a runtime

`server/sqlite.ts` používa WAL a atómové databázové dávky. `migrateApp` aplikuje verzované SQL migrácie z `drizzle` a uchováva ich kontrolné súčty; už aplikovaná migrácia sa nesmie spätne prepisovať. Better Auth pripravuje schému cez podporované migračné rozhranie. `server/start.ts` aplikuje migrácie pred prijímaním požiadaviek. Pri chybe migrácie sa server nespustí.

Produkčný runtime servíruje `dist/client`, API a auth endpointy pod cestou z `APP_URL`. Pred prijatím požiadaviek porovná prefix buildu s prefixom servera; nesúlad odmietne. Manifest a service worker používajú aktívnu cestu. `GET /healthz` kontroluje dostupnosť databázy bez používateľského účtu a vracia iba `{"ok":true}`. Nezávislý interval spracúva trvalú notifikačnú frontu, takže zavretie adminovho prehliadača spracovanie nezastaví.

Vývojová `/__qa` a izolovaný vizuálny test nie sú dostupným prihlasovacím mechanizmom. Fiktívne účty sa nezmiešavajú s produkčným ročníkom. Vývojový `AUTH_MAIL_MODE=file` ukladá skúšobné e-maily v súkromnom adresári (0700, súbory 0600); neoveruje doručenie do skutočnej schránky.

## Presun z Hubu na zimnykurz.sk

Začni s `APP_URL=https://hub.biketrek.sk/zk`. Pri neskoršom presune nastav `https://priprava.zimnykurz.sk`, zostav nový image a pridaj samostatný Caddy site blok pre subdoménu smerujúcu DNS na Hub. Hlavný web ani jeho menu sa nemenia. Alternatíva `https://zimnykurz.sk/priprava` zostáva podporovaná, ale potrebuje verejnú reverse proxy pred pôvodným webom. Zachovaj SQLite volume, `COURSE_ID` a `BETTER_AUTH_SECRET`. Účty, heslá, členstvá, aktivity, odmeny a správy zostanú. Heslový režim funguje na všetkých troch adresách a nevyžaduje pridanie SMTP.

Prehliadač neprenesie cookie medzi doménami, takže sa používateľ na novej adrese znovu prihlási zvoleným spôsobom. Na novej doméne tiež vedome zapne push a prípadne nahradí starú ikonu PWA. Server používa iba aktuálnu cestu z `APP_URL`: `/zk`, `/priprava` alebo koreň subdomény; `APP_URL` neobsahuje prihlasovacie údaje, query ani fragment. Podrobnosti sú v [DEPLOYMENT.md](DEPLOYMENT.md).

## Technické podklady

- [Better Auth: SQLite](https://better-auth.com/docs/adapters/sqlite)
- [Better Auth: username](https://better-auth.com/docs/plugins/username)
- [Better Auth: email OTP](https://better-auth.com/docs/plugins/email-otp)
- [Better Auth: migrácie](https://better-auth.com/docs/concepts/database)
- [Better Auth: limity a proxy](https://better-auth.com/docs/concepts/rate-limit)
- [Better Auth: origin a cookies](https://better-auth.com/docs/reference/options)

Presné verzie závislostí sú uzamknuté v lockfile. Rozsah skutočne vykonaných kontrol uvádza [TESTING.md](TESTING.md); konfigurácia v tomto dokumente nie je potvrdením živého nasadenia.
