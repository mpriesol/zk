# Cestou Zimy

Mobilná aplikácia pre dobrovoľnú prípravu účastníkov zimného kurzu. React + TypeScript, Node 24, SQLite a Better Auth s jednorazovým e-mailovým kódom. Server kontroluje členstvo a oprávnenia pri každej požiadavke. Dáta sú v trvalej databáze, nie v localStorage.

## Spustenie

Vyžaduje Node **24.15+** a pnpm **11.25.0**. `corepack enable` zapne pnpm podľa package.json.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
node scripts/generate-keys.mjs >> .env
```

Vyplň `APP_URL` (prvé nasadenie `https://hub.biketrek.sk/zk`, lokálne `http://localhost:3000/zk`), `BOOTSTRAP_ADMIN_EMAIL` a SMTP v `.env`. Tajomstvo generuj raz, nie pri každom štarte. Pre lokálny vývoj možno použiť `AUTH_MAIL_MODE=file`; prihlasovacie e-maily sa zapisujú do súkromného adresára `MAIL_DIRECTORY`. Tento režim produkčný server odmietne. Kód sa nikdy nevracia do prehliadača. Podrobnosti v [docs/AUTH.md](docs/AUTH.md).

```sh
pnpm dev
```

Pri prvom štarte sa aplikujú SQL migrácie a schéma Better Auth. Prvý admin sa bezpečne vytvorí až po overení e-mailu z `BOOTSTRAP_ADMIN_EMAIL`. Verejná registrácia do kurzu neexistuje. Následne v administrácii nastav skutočný názov/obdobie a pozvi členov. Nastavenie bootstrap e-mailu môžeš po vytvorení admina odstrániť.

## Vývojové údaje

```sh
pnpm seed:demo
```

Seed vyžaduje vývojový režim a testovací kurz. Vytvorí označené fiktívne účty, aktivity, výzvy a správy; účty sa prihlasujú rovnakým OTP mechanizmom. Neexistuje prepínač prihlasovacej roly ani verejné heslo. Spustenie seed na reálnom kurze/produkcii je zakázané. Inštrukcie a adresy vypíše seed. SMTP neposiela skúšobné kódy, ak je zvolený súborový režim.

## Kontroly

```sh
pnpm typecheck
pnpm test
pnpm build
```

[docs/TESTING.md](docs/TESTING.md) uvádza presný rozsah kontrol a zvyšné limity. Samotný úspešný build nie je overením doručenia e-mailu alebo push do telefónu.

## Docker a Caddy

[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) obsahuje nasadenie, migrácie, zálohy a návrat na predchádzajúcu verziu. `docker-compose.yml` používa existujúcu externú sieť **inventory-hub-net** a alias **zk-app**. Container nepublikuje port do internetu; existujúci Caddy proxy smeruje na `zk-app:3000`.

Prvé nasadenie a testovanie beží na **https://hub.biketrek.sk/zk** a potrebuje iba existujúci Hub Caddy. Blok vygeneruj podľa postupu v dokumentácii cez Docker (alebo lokálne s Node 24: `node --env-file=zk.env scripts/render-caddy.mjs`) a pridaj do existujúceho bloku `hub.biketrek.sk` pred jeho všeobecnú SPA routu. Nesmie nahradiť celý Caddyfile ani odstrániť Hub/SPS routy.

Neskôr nastavíš `APP_URL=https://zimnykurz.sk/priprava`, urobíš rebuild a nahradíš iba ZK blok novým výstupom renderera. Hosting zimnykurz.sk potom musí serverovo proxyovať `/priprava` na **https://hub.biketrek.sk/zk**. Nejde o 301/302 presmerovanie ani iframe. Databázový volume a účty zostanú; používatelia sa na novej doméne znovu prihlásia a zapnú push. Pripravené sú nginx, Apache a Caddy fragmenty a postup v dokumentácii; možnosti tohto hostingu ešte nie sú overené. Existujúca produkcia sa automaticky nemení.

## Kde upravovať správanie

- Bežné pravidlá, názvy, termíny, typy, výzvy a správy: **Administrácia** v aplikácii.
- Herné šablóny a prvé pravidlá: `lib/gamification.ts`; verzie a uložené odmeny: `lib/server.ts`.
- Vzhľad a tokeny: `app/globals.css`; originálne podklady: `public/brand`.
- Veverička: `components/Squirrel.tsx`; limit v nastavení kurzu, osobné vypnutie v **Ja**.
- Prihlásenie: `server/auth.ts`; bezpečné pozvánky a členstvo: `lib/server.ts`.
- Push: `lib/push.ts`, `lib/outbox.ts`, `public/sw.js` a [docs/PUSH.md](docs/PUSH.md).

## Dokumentácia

[Produkt](docs/PRODUCT.md) · [Gamifikácia](docs/GAMIFICATION.md) · [Dizajn](docs/DESIGN.md) · [Prihlásenie](docs/AUTH.md) · [Nasadenie](docs/DEPLOYMENT.md) · [Testovanie](docs/TESTING.md)

Repozitár obsahuje bežné zdrojové súbory; aplikácia nie je závislá od náhľadu v ChatGPT ani od prihlásenia účastníkov cez ChatGPT. Licencie fontov sú priložené; pôvod a použitie kurzových ilustrácií je zdokumentované v `docs/DESIGN.md`.
