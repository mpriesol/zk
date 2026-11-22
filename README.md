# Cestou Zimy

Webová aplikácia pre PC aj mobil na dobrovoľnú prípravu účastníkov zimného kurzu. React + TypeScript, Node 24, SQLite a Better Auth. Predvolené prihlásenie používa používateľské meno a heslo; e-mailový kód je voliteľný. Server kontroluje členstvo a oprávnenia pri každej požiadavke. Dáta sú v trvalej databáze, nie v localStorage.

## Spustenie

Vyžaduje Node **24.15+** a pnpm **11.25.0**. `corepack enable` zapne pnpm podľa package.json.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
node scripts/generate-keys.mjs >> .env
```

Vyplň `APP_URL` (prvé nasadenie `https://hub.biketrek.sk/zk`, lokálne `http://localhost:3000/zk`). Predvolené `AUTH_MODE=password` nepotrebuje SMTP ani e-mail. Tajomstvo generuj raz, nie pri každom štarte. Voliteľné `AUTH_MODE=email` alebo `both` zapne e-mailový kód a v produkcii vyžaduje SMTP. Podrobnosti sú v [docs/AUTH.md](docs/AUTH.md).

```sh
pnpm dev
```

Pri prvom štarte sa aplikujú SQL migrácie a schéma Better Auth. Prvého organizátora vytvor lokálne príkazom:

```sh
node --env-file=.env --experimental-strip-types scripts/create-admin.ts
```

Skript sa opýta na meno a dvakrát na skryté heslo. V Dockeri sa spúšťa cez `docker compose ... exec -it`, podľa [nasadenia](docs/DEPLOYMENT.md). Prvý verejne registrovaný používateľ sa nikdy nestane adminom. Účastníci si vytvárajú vlastnú prezývku a heslo. Voliteľné celé meno je súkromné a ostatní vidia iba prezývku. S platnou pozvánkou sú aktívni, inak čakajú na schválenie. V administrácii nastav názov a obdobie kurzu. Prihlásenie zostáva uložené na PC aj mobile (30-dňová obnovovaná session).

## Vývojové údaje

```sh
pnpm seed:demo
```

Seed vyžaduje vývojový režim, samostatnú testovaciu databázu a `AUTH_MAIL_MODE=file`. Pre prihlásenie k týmto existujúcim fiktívnym e-mailovým účtom nastav aj `AUTH_MODE=email`; seed nevytvára heslá. Vytvorí označené aktivity, výzvy a správy. Neexistuje prepínač prihlasovacej roly ani verejné heslo. Spustenie seed na reálnom kurze/produkcii je zakázané. Inštrukcie a adresy vypíše seed. SMTP neposiela skúšobné kódy, ak je zvolený súborový režim.

## Kontroly

```sh
pnpm typecheck
pnpm test
pnpm build
```

[docs/TESTING.md](docs/TESTING.md) uvádza presný rozsah kontrol a zvyšné limity. Samotný úspešný build nie je overením doručenia e-mailu alebo push do telefónu.

## Docker a Caddy

[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) obsahuje nasadenie, migrácie, zálohy a návrat na predchádzajúcu verziu. `docker-compose.yml` používa existujúcu externú sieť **inventory-hub-net** a alias **zk-app**. Container nepublikuje port do internetu; existujúci Caddy proxy smeruje na `zk-app:3000`.

Prvé nasadenie a testovanie je určené pre **https://hub.biketrek.sk/zk** a potrebuje iba existujúci Hub Caddy. Blok vygeneruj podľa postupu v dokumentácii cez Docker (alebo lokálne s Node 24: `node --env-file=zk.env scripts/render-caddy.mjs`) a pridaj do existujúceho bloku `hub.biketrek.sk` pred jeho všeobecnú SPA routu. Nesmie nahradiť celý Caddyfile ani odstrániť Hub/SPS routy.

Preferovaná budúca adresa je **https://priprava.zimnykurz.sk**. Nastaví sa DNS iba tejto subdomény na Hub server, `APP_URL` na novú adresu bez prefixu, urobí sa rebuild a do Caddy pribudne samostatný site z `deploy/Caddyfile.zk.subdomain`. Starý `/zk` blok sa nahradí fragmentom `deploy/Caddyfile.zk.redirect`; účastníci potom používajú iba novú adresu. Pôvodný web `zimnykurz.sk` aj jeho menu zostávajú bez zmeny a PR do `jurajk/zkweb` nie je potrebný.

Databázový volume, účty a heslá zostanú; používatelia sa na novej doméne znovu prihlásia a zapnú push. Alternatíva **https://zimnykurz.sk/priprava** je naďalej pripravená, ale potrebuje verejnú serverovú reverse proxy. GitHub Pages z pôvodného webového repozitára ju neposkytne samotnou zmenou statických súborov. Podrobný postup pre obe možnosti je v dokumentácii; žiadne DNS ani existujúca produkcia sa automaticky nemenia.

## Príprava a ďalšie ročníky

Mobilná navigácia má päť položiek: **Spolu** (Dnes v skupine, denné motto a spoločný feed po dňoch), **Prehľad** (týždeň/mesiac po ľuďoch, otužovanie, spoločné štatistiky), **+** (nový zápis), **Výzvy** (drahokamy, výzvy, zbierka) a **Ja** (vlastný týždeň/mesiac, zápisy, profil, upozornenia, heslo, návod, administrácia). Správy sú pod zvončekom. Fotografie a avatary sa bezpečne ukladajú mimo klienta. Otužovanie má samostatné vločky a nepridáva pohybové minúty.

Organizátor môže upravovať vizuály odmien, zverejniť dobrovoľné praktické úlohy alebo udeliť vlastné ocenenie. Administrátorské štatistiky obsahujú presne definované maximá, remízy a nominácie s návrhom rozdelenia medzi viacerých ľudí. Denné citáty majú autora, zdroj, originál a označenie slovenského prekladu.

**Aktualizácia existujúcu prípravu neresetuje.** Migrácia zmení známe testovacie názvy na ročník 2027 a doplní hlavný kurz 3.–7. 2. 2027, ale zachová existujúce obdobie prípravy a údaje. Administrátorské **Spustiť prípravu na zimný kurz** je samostatný potvrdený krok s konkrétnymi dátumami, presným náhľadom výmazu a povinnou zálohou. Ročník ani dátumy ďalších období nie sú pevne viazané na rok 2027.

Pri prvom nasadení tejto verzie vytvor zálohovací host adresár `/srv/cestou-zimy-backups` pre uid/gid 1000 (postup v DEPLOYMENT.md). Automatika štandardne vytvorí jednu overenú zálohu DB aj médií denne; existujúci host cron sa nastaví ako externý plánovač.

## Kde upravovať správanie

- Bežné pravidlá, názvy, termíny, typy, výzvy a správy: **Administrácia** v aplikácii.
- Herné šablóny a prvé pravidlá: `lib/gamification.ts`; verzie a uložené odmeny: `lib/server.ts`.
- Vzhľad a tokeny: `app/globals.css`; originálne podklady: `public/brand`.
- Medvedík: `components/Squirrel.tsx`; limit v nastavení kurzu, osobné vypnutie v **Profil a nastavenia**.
- Prihlásenie: `server/auth.ts`, `server/accounts.ts`; prvý organizátor: `scripts/create-admin.ts`; členstvo: `lib/server.ts`.
- Push: `lib/push.ts`, `lib/outbox.ts`, `public/sw.js` a [docs/PUSH.md](docs/PUSH.md).

## Dokumentácia

[Návod pre účastníkov](docs/NAVOD_PRE_UCASTNIKOV.md) · [Organizátor](docs/ADMINISTRATOR.md) · [Produkt](docs/PRODUCT.md) · [Gamifikácia](docs/GAMIFICATION.md) · [Dizajn](docs/DESIGN.md) · [Prihlásenie](docs/AUTH.md) · [Nasadenie](docs/DEPLOYMENT.md) · [Testovanie](docs/TESTING.md)

Repozitár obsahuje bežné zdrojové súbory; aplikácia nie je závislá od náhľadu v ChatGPT ani od prihlásenia účastníkov cez ChatGPT. Licencie fontov sú priložené; pôvod a použitie kurzových ilustrácií je zdokumentované v `docs/DESIGN.md`.
