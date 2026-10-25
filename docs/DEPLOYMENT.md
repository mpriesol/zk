# Nasadenie Cestou Zimy na vlastnom serveri

Projekt je samostatná aplikácia v repozitári `mpriesol/zk`. Runtime tvorí Node.js 24, React SPA a SQLite v trvalom volume. Prihlásenie zabezpečuje Better Auth s jednorazovým e-mailovým kódom cez SMTP. Nevyžaduje ChatGPT účet, Supabase ani novú platenú službu. Web push potrebuje vlastný VAPID pár a HTTPS.

## Overená infraštruktúra a hranice overenia

25. 10. 2026 bola cez GitHub prečítaná aktuálna konfigurácia:

- `mpriesol/inventory_hub/infra/docker-compose.prod.yml`, blob `7bb33cf03031d03587b083c791774d360ea7b321`: existujúci `caddy` je v sieti `inventory-hub-net` aj `sps-proxy`, obsadzuje porty 80/443 a má pripojený `./caddy/Caddyfile` do `/etc/caddy/Caddyfile`.
- `mpriesol/inventory_hub/infra/Caddyfile`, blob `4f3591fc384ceec2fa6f616b27e0bef5e6d2c0a8`: obsahuje Hub `/api/*`, `/data/*` a frontend fallback. Tento súbor **neobsahuje aktuálne SPS smerovanie**, preto nesmie nahradiť skutočný serverový Caddyfile.
- `mpriesol/sps/deploy/Caddyfile.snippet`, blob `84408ba6d3a27e010a94be1683b8d6797cec19f6`: SPS používa `/sps/*` a `sps-receiver:8080`; dané smerovanie zachovať.

Živý server, jeho skutočné pripojenia, DNS, SMTP a HTTPS neboli z tohto pracovného prostredia overené. Repozitáre a bežiaca produkcia Hub/SPS neboli upravené; zmeny patria iba do repozitára aplikácie `mpriesol/zk`. Docker daemon nie je v pracovnom prostredí dostupný, preto build image a `docker compose up` treba overiť na cieľovom serveri. Lokálne testy zálohy/obnovy a renderovania Caddy šablóny sú skutočne spustiteľné: `node --experimental-strip-types --test tests/backup.test.ts`.

**Skutočne overené:** oficiálny Caddy **2.11.7** lokálne načítal pripravený Hub fragment a prešlo 22 živých HTTP kontrol v oboch režimoch `APP_URL`: exact `/zk`, slash, zachovanie `/zk` aj prepis na `/priprava`, API/auth/SW cesty, query, POST body, Host/Origin/proto, odstránenie podvrhnutej identity/IP aj zachovanie Hub/SPS/fallback routes. Test používa lokálny stub backend a dočasný Caddy, nie produkciu. Opakovanie: `CADDY_BIN=/cesta/k/caddy node scripts/check-caddy.mjs`. To nepotvrdzuje frontendový nginx/Apache hosting, jeho TLS, DNS ani celý reťazec cez zimnykurz.sk.

## Prvé nasadenie a neskorší presun URL

**Prvé nasadenie je určené pre https://hub.biketrek.sk/zk.** Potrebuje iba existujúci Hub server, nový samostatný kontajner a doplnenie jeho Caddy. Prístup k hostingu zimnykurz.sk toto prvé spustenie neblokuje. Tento dokument sám osebe nepotvrdzuje vykonané nasadenie.

**Neskôr sa môže verejná adresa zmeniť na https://zimnykurz.sk/priprava**, keď bude overený a nastavený reverse proxy prístup k tomuto hostingu. Aplikácia fyzicky ostane na tom istom serveri aj v tom istom databázovom volume.

| Nastavenie `APP_URL` | Prehliadač a Node prefix | Hub Caddy `/zk/*` | Front hosting |
|---|---|---|---|
| `https://hub.biketrek.sk/zk` — prvé nasadenie | `/zk`, Host `hub.biketrek.sk` | Zachová cestu `/zk/*` | Netreba |
| `https://zimnykurz.sk/priprava` — neskorší presun | `/priprava`, Host `zimnykurz.sk` | Prepíše prefix `/zk` na `/priprava` | Proxy `/priprava/*` → `https://hub.biketrek.sk/zk/*` |

**Jediné nastavenie je `APP_URL` v `zk.env`, vždy vrátane prefixu.** Z neho build odvodí assety, navigáciu, service worker aj manifest; runtime odvodí API, auth a cookie scope. Docker build vytvorí `build-config.json`; server pri štarte overí zhodu s runtime prefixom, aby nebežal starý frontend na novej URL. Po zmene `APP_URL` je potrebný **rebuild image, reštart iba ZK kontajnera a nové vygenerovanie ZK Caddy fragmentu**. Nie je potrebná ručná úprava zdrojového kódu ani samostatná premenná `APP_BASE_PATH`.

Docker build dostane `APP_URL` ako netajný build argument; runtime ju načíta z toho istého `zk.env`. Všetky Compose príkazy preto používajú `--env-file zk.env`. Ak má shell exportovanú inú `APP_URL`, odstráň toto prepísanie (`unset APP_URL`) pred spustením. Ostatné tajomstvá nie sú build argumenty a nepatria do image.

Nový kontajner nepublikuje hostiteľský port, používa `inventory-hub-net` a nemení Hub/SPS Compose služby. V prvom režime je `/zk` skutočná účastnícka adresa. Po neskoršom presune je `/zk` technický upstream a účastníci používajú `/priprava` na novom origine. Prehliadač neprenesie cookie prihlásenia ani push povolenie na inú doménu; používateľ sa znovu prihlási a vedome zapne push na novej adrese. Server označuje push odbery originom a neposiela správy cez staré odbery iného originu. Starú nainštalovanú PWA treba odstrániť alebo ďalej nepoužívať.

## Konfigurácia

Vyžaduje Docker Engine a Docker Compose **aspoň 2.30**, pretože `env_file.format: raw` zachová `$` a ďalšie znaky SMTP hesiel. Na serveri skopíruj `.env.example` do `zk.env`, vyplň skutočné hodnoty a nastav `chmod 600 zk.env`. V súbore `zk.env` hodnoty nepísať do obalových úvodzoviek; raw formát ich ponechá ako súčasť hodnoty. Pri priamom lokálnom Node spúšťaní môžeš používať `.env` podľa README.

| Premenná | Význam |
|---|---|
| `APP_URL` | Teraz `https://hub.biketrek.sk/zk`; neskôr `https://zimnykurz.sk/priprava`. Zmena vyžaduje rebuild a nový ZK Caddy fragment. |
| `BETTER_AUTH_SECRET` | Náhodný tajný reťazec aspoň 32 znakov; napr. vytvorený `openssl rand -base64 48`. Uchovať mimo Git a záloh verejného kódu. |
| `BOOTSTRAP_ADMIN_EMAIL` | E-mail prvého organizátora. Použiť skutočnú schránku; nie demo konto. |
| `COURSE_ID` | Identifikátor ročníka, predvolene `cestou-zimy`. Nemeniť pri bežnom reštarte. |
| `AUTH_MAIL_MODE` | V produkcii `smtp`. Vývojové `file` sa v produkcii odmieta. |
| `SMTP_HOST`, `SMTP_PORT` | Existujúci SMTP server a port, zvyčajne 587. |
| `SMTP_SECURE` | `true` pre implicitné TLS na 465; pre 587 `false` s STARTTLS. |
| `SMTP_USER`, `SMTP_PASSWORD` | SMTP prihlasovanie; možno vynechať iba pri úmyselne nakonfigurovanom dôveryhodnom relayi. |
| `MAIL_FROM` | Overená adresa/odosielateľ povolený poskytovateľom SMTP. |
| `TRUST_PROXY` | `1` iba za priloženým Caddy smerovaním, ktoré prepíše `X-Real-IP`; server nesmie byť dostupný priamo z internetu. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Voliteľný web push; private key zostáva na serveri, subject je kontaktná `mailto:` alebo HTTPS adresa. Bez konfigurácie sa zapnutie push nepovažuje za úspešné. |
| `DATABASE_PATH`, `HOST`, `PORT`, `NODE_ENV` | Compose nastavuje `/data/cestou-zimy.sqlite`, `0.0.0.0`, `3000`, `production`. |

Produkčné SMTP treba otestovať skutočným prijatím OTP e-mailu, expiráciou, opätovným odoslaním a prihlásením pozvaného účastníka. Over SPF/DKIM/DMARC podľa existujúceho poskytovateľa. Neodosielaj skutočné pozvánky počas testovania bez zámeru organizátora.

## Spustenie samostatného stacku

Pracuj v samostatnom adresári, napr. `/opt/cestou-zimy`. Nepoužívaj adresár ani Compose projekt Hubu.

```sh
git clone https://github.com/mpriesol/zk.git /opt/cestou-zimy
cd /opt/cestou-zimy
cp .env.example zk.env
chmod 600 zk.env
# Vyplň zk.env, pred ďalším krokom.
docker compose version
docker network inspect inventory-hub-net
docker inspect inventory-hub-caddy-1 --format '{{json .NetworkSettings.Networks}}'
docker compose --env-file zk.env -p cestou-zimy config --quiet
docker compose --env-file zk.env -p cestou-zimy build
docker compose --env-file zk.env -p cestou-zimy up -d --no-deps zk-app
docker compose --env-file zk.env -p cestou-zimy ps
docker compose --env-file zk.env -p cestou-zimy logs --tail=80 zk-app
```

Ak sieť `inventory-hub-net` neexistuje alebo v nej nie je Caddy, najprv porovnaj skutočnú konfiguráciu servera. Nevytváraj ďalšiu rovnako vyzerajúcu sieť a neprepájaj Hub naslepo. Nový Compose projekt má vlastný volume `cestou-zimy_zk_data`, SQLite aj účty sú oddelené od Hub PostgreSQL a SPS.

Kontajner beží ako neprivilegovaný používateľ, root filesystem je read-only a zapisuje iba do `/data` a dočasného `/tmp`. Prvý named volume zdedí vlastníka UID 1000; pri ručnom importe volume oprav vlastníctvo pre UID/GID 1000. V produkcii spúšťaj **jednu repliku** tejto aplikácie. Nezdieľaj SQLite súbor cez NFS ani medzi nezávislými kontajnermi.

### Prvý organizátor

Pred prvým spustením nastav `BOOTSTRAP_ADMIN_EMAIL` na svoju schránku. Otvor aplikáciu, požiadaj o kód a over ho cez skutočný e-mail. Až serverom overená identita s týmto e-mailom môže pri prvom načítaní `<aktívny prefix>/api/state` vytvoriť ešte neexistujúci kurz a členstvo organizátora. Frontend neponúka voľbu roly a neexistuje verejný bootstrap endpoint s univerzálnym heslom. Ak kurz už existuje, zmena tejto premennej neprepisuje jeho členov alebo role. Ďalších ľudí pozýva organizátor cez administráciu.

## 1. Hub gateway: bezpečné doplnenie Caddy

Toto je samostatný krok do existujúcej produkčnej konfigurácie; vykonaj ho až po odsúhlasení nasadenia. Nová služba používa existujúci Caddy aj siete.

1. Zisti skutočný zdroj pripojeného Caddyfile:

   ```sh
   docker inspect inventory-hub-caddy-1 --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}'
   ```

2. Zálohuj **tento aktuálny súbor**, vrátane `/sps`, `/api`, `/data` a ostatných domén. Nepouži starý Caddyfile z repozitára ako náhradu.
3. Vytvor reviewovateľný fragment:

   ```sh
   docker compose --env-file zk.env -p cestou-zimy run --rm --no-deps zk-app node scripts/render-caddy.mjs > deploy/Caddyfile.zk.rendered
   ```

   Skript podľa `APP_URL` vyberie prvotný Hub fragment alebo budúci verejný fragment. Prázdnu, cudziu alebo neplatnú URL odmietne. Iba vypíše lokálny fragment, nemení server a nepotrebuje `ZK_DOMAIN`.
4. Vlož celý **vygenerovaný** fragment (prvý režim vychádza z `deploy/Caddyfile.zk`, druhý z `deploy/Caddyfile.zk.public`) **dovnútra existujúceho `hub.biketrek.sk { ... }`**, pred fallback `handle`, ktorý obsluhuje Hub SPA. Zachovaj `/sps`, `/api`, `/data` a ostatné routes. Ilustračný diff:

   ```diff
    hub.biketrek.sk {
        # Existujúce /api, /data a /sps routes ostávajú.
   +    @cestouZimyGateway path /zk /zk/*
   +    handle @cestouZimyGateway {
   +        # V prvom režime sa /zk zachová, pri presune sa prepíše na /priprava.
   +        # Celá konfigurácia hlavičiek z deploy/Caddyfile.zk
   +        reverse_proxy zk-app:3000
   +    }
        handle {
            # Existujúci Hub SPA fallback ostáva.
        }
    }
   ```

   Použi celý vygenerovaný fragment, nie skrátený diff. Prvý režim prefix zachová, druhý regexom prepíše iba `/zk` na `/priprava`; query ostáva zachované. `/sps/*`, `/api/*`, `/data/*`, `/zk-other` sa neodchytávajú. Nepoužívaj samotné `handle_path /zk/*`, pretože aplikácia potrebuje aktívny prefix. Pri presune existujúci ZK blok **nahraď**, nepridávaj druhý rovnaký matcher.
5. Skopíruj kandidáta do kontajnera ako `/tmp/Caddyfile.zk-candidate` a validuj:

   ```sh
   docker cp /CESTA/K/Caddyfile.zk-candidate inventory-hub-caddy-1:/tmp/Caddyfile.zk-candidate
   docker exec inventory-hub-caddy-1 caddy validate --config /tmp/Caddyfile.zk-candidate --adapter caddyfile
   ```

6. Po úspešnej validácii zapíš kandidáta do pôvodného hostiteľského súboru. Pri bind-mounte jednotlivého súboru zachovaj inode zápisom do existujúceho súboru, aby kontajner neostal pripojený k starej verzii. Reload:

   ```sh
   docker exec inventory-hub-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
   ```

7. V prvom režime over prihlásenie priamo na `https://hub.biketrek.sk/zk` aj nezmenený Hub/SPS. Verejná proxy nižšie je potrebná **až pri neskoršom presune**. Pri probléme obnov zálohovaný Caddyfile, validuj a reloadni. Ostatné kontajnery neodstraňuj.

Nespúšťaj `docker compose down` v adresári Hubu ani reštart všetkých kontajnerov. Vygenerovaný fragment nastaví upstream `Host` a `X-Forwarded-Host` podľa vybraného `APP_URL` (`hub.biketrek.sk` alebo `zimnykurz.sk`), protokol na HTTPS a ponechá pôvodný browser `Origin`. Auth nesmie dôverovať podvrhnutej identite v hlavičkách.

## Neskorší presun bez straty databázy

Po overení dostupnosti verejnej proxy postupuj takto:

1. Priprav konfiguráciu hostingu opísanú nižšie a dohodni krátke okno na prepnutie. Aktiváciu nesmie nahradiť iba zmena `APP_URL`.
2. V `/opt/cestou-zimy` sprav zálohu, poznač aktuálny commit a odlož aktuálny ZK Caddy blok:

   ```sh
   docker compose --env-file zk.env -p cestou-zimy exec -T zk-app node scripts/backup.mjs
   git rev-parse HEAD
   ```

3. V `zk.env` zmeň **iba** `APP_URL` na `https://zimnykurz.sk/priprava`. Zachovaj `BETTER_AUTH_SECRET`, `COURSE_ID`, SMTP, VAPID aj databázový volume. Nemeň identitu kurzu a nespúšťaj reset alebo demo seed.
4. Z toho istého adresára znovu zostav frontend a spusti iba ZK kontajner:

   ```sh
   docker compose --env-file zk.env -p cestou-zimy up -d --build --no-deps zk-app
   docker compose --env-file zk.env -p cestou-zimy run --rm --no-deps zk-app node scripts/render-caddy.mjs > deploy/Caddyfile.zk.rendered
   ```

5. Vo skutočnom Hub Caddyfile **nahraď len existujúci ZK matcher/handle blok** novým fragmentom. Ostatné routes zachovaj. Použi postup kandidát → validácia → reload vyššie; nepridávaj duplicitný blok.
6. Aktivuj pripravenú proxy na hostingu zimnykurz.sk. Over prihlásenie, zápis, reload, komentár, oznámenia, manifest a service worker na `https://zimnykurz.sk/priprava`. Počítaj s opätovným loginom účastníkov a novým vedomým zapnutím push.
7. Skontroluj, že pôvodné členstvo, aktivity, komentáre a odmeny ostali. Zmena URL nemení SQLite volume `cestou-zimy_zk_data`. **Nikdy nepoužívaj `down -v`, `docker volume rm` ani nový Compose project name** ako súčasť presunu.

Ak hostingový krok zlyhá, zmeň `APP_URL` späť na `https://hub.biketrek.sk/zk`, zopakuj rebuild/reštart iba ZK, vygeneruj a obnov Hub režim jeho Caddy fragmentu. Pri samotnej zmene URL sa databáza neobnovuje zo zálohy, pretože by sa zbytočne stratili nové záznamy. Záloha slúži pre skutočné poškodenie dát alebo nekompatibilnú migráciu.

## Neskorší presun: verejná proxy na hostingu zimnykurz.sk

Túto časť netreba pre prvé nasadenie na Hube. Prístup a podpora proxy na hostingu zimnykurz.sk sú zatiaľ neoverené. Iframe ani HTTP redirect na Hub nenahrádzajú serverovú reverse proxy. Zisti od správcu hostingu, či používa nginx, Apache alebo inú reverznú proxy a či smie nakonfigurovať backendové HTTPS spojenie. Potrebujeme aj **skutočné odchádzajúce IP adresy proxy** kvôli bezpečnému určeniu IP pre limity loginu.

- **nginx:** `deploy/zimnykurz-nginx.conf` patrí do existujúceho HTTPS `server` bloku `zimnykurz.sk`. Samostatný exact matcher presmeruje `/priprava` na `/priprava/`; prefixová location prenáša zvyšok cesty na `/zk/`. Obe trailing slash v `proxy_pass` sú zámerné. Pred reloadom musí na hostingu prejsť `nginx -t`.
- **Apache:** `deploy/zimnykurz-apache.conf` patrí do existujúceho TLS VirtualHost, s `mod_proxy`, `mod_proxy_http`, `mod_ssl`, `mod_headers` a `mod_alias`. Nie je to bežná `.htaccess` konfigurácia. Hosting musí povoliť proxy moduly; over `apachectl configtest` pred reloadom. Fragment zachováva pôvodný web mimo `/priprava`.
- **Ak zimnykurz.sk už obsluhuje ten istý Caddy a Docker sieť:** voliteľne použi `deploy/zimnykurz-Caddyfile.snippet` v jeho existujúcom site bloku. Vtedy môže Caddy poslať `/priprava` priamo na `zk-app:3000` a technická vzdialená proxy nie je potrebná. Túto topológiu nepredpokladáme bez overenia.

Nginx/Apache fragmenty sú nastavené na TLS s overovaním certifikátu pre spojenie na `hub.biketrek.sk` so správnym backendovým Host a SNI. Cestu CA bundle uprav podľa systému hostingu; nevypínaj kontrolu certifikátu. Cookie už má kanonické `Path=/priprava`, preto ju neprepisuj na `/zk`. Pôvodný `Origin: https://zimnykurz.sk` musí prejsť nezmenený. Nekopíruj OTP, SMTP heslá alebo auth secret do proxy konfigurácie. Nepridávaj `hub.biketrek.sk` ako všeobecne dôveryhodný browser origin len na obídenie zlej konfigurácie.

Verejný hosting nesmie cachovať `/priprava/api/*`, auth odpovede ani personalizovaný HTML obsah; prepared fragmenty proxy cache vypínajú. CDN, ak existuje, musí rešpektovať rovnakú výnimku. Všetky navigačné odkazy, assety, manifest aj service worker smerujú na `/priprava/...`; prehliadač nemá načítavať privátne API z inej domény. PWA scope má byť `/priprava/`, nikdy celý pôvodný web.

### Skutočná IP a limity prihlásenia

Default je bezpečný: Caddy vloží `X-Real-IP {client_ip}`, pričom bez explicitne dôveryhodných proxy adries `{client_ip}` znamená socket peer. Pri vzdialenom hostingu je to IP jeho gateway, takže viacerí účastníci môžu zdieľať IP limit OTP. Napríklad pri limite 3 pokusov/minútu môže jeden človek dočasne blokovať druhého. Pred skupinovým používaním treba overiť limity aj reálne odovzdávanie IP; samotná funkčná stránka nestačí.

Až po získaní presných IP/CIDR verejného proxy a overení, že proxy prepisuje používateľský `X-Forwarded-For`, doplň do **existujúcich** globálnych Caddy server options:

```caddyfile
{
    servers {
        trusted_proxies static OVERENE_IP_ALEBO_CIDR_HOSTINGU
        trusted_proxies_strict
        client_ip_headers X-Forwarded-For
    }
}
```

Placeholder je zámerne neplatný a musí sa nahradiť overenou IP. Nevkladaj druhý globálny blok, nevymazávaj existujúce server options a nepoužívaj `0.0.0.0/0`, `::/0` alebo ľubovoľnú hlavičku od klienta. Caddy server options môžu ovplyvniť viac domén na rovnakom listeneri; zmenu skontroluj proti aktuálnej konfigurácii. Aplikácia má `TRUST_PROXY=1` iba preto, že jej interný port je izolovaný a priložený Caddy vždy prepisuje hlavičku. Pokiaľ nepoznáme IP hostingu, ponechaj bezpečný default a považuj viacpoužívateľské limity za neoverené.

Pre `trusted_proxies_strict` je potrebný Caddy aspoň 2.8; over skutočnú verziu na serveri, neaktualizuj zdieľaný proxy kontajner bez samostatného rozhodnutia.

## Migrácie a aktualizácie

SQLite migrácie patria k verzii kódu. Pred aktualizáciou sprav overenú zálohu, ulož aktuálny commit a zachovaj runtime tajomstvá. Aplikovanú migráciu spätne neprepisuj. Pri zmene databázovej schémy samotný návrat k starému image nemusí stačiť; bezpečný rollback môže vyžadovať obnovu databázy zo zálohy k príslušnej verzii.

Pri štarte sa aplikujú SQL migrácie z `drizzle/*.sql` v poradí. Tabuľka `__app_migrations` uchováva ich kontrolné súčty a odmietne prepísanú už aplikovanú migráciu. Potom sa aplikujú migrácie Better Auth cez jeho podporované rozhranie. Rovnaký explicitný krok možno po zostavení image a pri zastavenej aplikácii spustiť cez `docker compose --env-file zk.env -p cestou-zimy run --rm --no-deps zk-app node --experimental-strip-types scripts/migrate.ts`. Takto sa použije správny produkčný volume a konfigurácia. Migrácie sú idempotentné a nenahrádzajú produkčné dáta demo seedom.

```sh
cd /opt/cestou-zimy
docker compose --env-file zk.env -p cestou-zimy exec -T zk-app node scripts/backup.mjs
git rev-parse HEAD
git pull --ff-only
docker compose --env-file zk.env -p cestou-zimy build
docker compose --env-file zk.env -p cestou-zimy up -d --no-deps zk-app
docker compose --env-file zk.env -p cestou-zimy ps
```

Tieto príkazy sa týkajú iba ZK stacku. Bežná aktualizácia nemení Caddy ani ostatné aplikácie.

## Zálohovanie a obnova

`scripts/backup.mjs` používa SQLite online backup API, takže zahrnie aj necheckpointované WAL zápisy. Výsledok skontroluje cez `PRAGMA integrity_check` a nastaví oprávnenia 0600. Nekopíruj len živý `.sqlite` súbor, pretože aktuálne dáta môžu byť vo WAL.

```sh
docker compose --env-file zk.env -p cestou-zimy exec -T zk-app node scripts/backup.mjs
```

Skript vypíše presnú cestu `/data/backups/...sqlite`. Prenes tento súbor cez `docker compose --env-file zk.env -p cestou-zimy cp zk-app:/data/backups/KONKRETNY_SUBOR.sqlite /BEZPECNA/CESTA/` aj mimo server. Záloha v rovnakom volume chráni pred chybnou zmenou, nie pred stratou servera. SQLite obsahuje členov, súkromné zápisy, účty a push subscription; zálohu chráň ako osobné údaje. Oddelene zálohuj `zk.env` a chráň ho pred prístupom nepovolaných osôb. Naplánovanie a retenčnú politiku nastavuje prevádzkovateľ; nič sa tu automaticky neodosiela tretej strane.

Pred obnovou musí byť aplikácia zastavená. Vopred skopíruj zvolenú zálohu do `/data/backups/`:

```sh
docker compose --env-file zk.env -p cestou-zimy stop zk-app
docker compose --env-file zk.env -p cestou-zimy run --rm --no-deps zk-app node scripts/restore.mjs /data/backups/KONKRETNY_SUBOR.sqlite --confirm-stopped
docker compose --env-file zk.env -p cestou-zimy up -d --no-deps zk-app
```

Obnova najprv skontroluje integritu a tabuľku `courses`, zachová predchádzajúcu databázu ako `*.before-restore-*`, pripraví nový súbor a až potom ho vymení. Argument `--confirm-stopped` nie je automatická detekcia kontajnera: prevádzkovateľ zodpovedá za predchádzajúce zastavenie servera. Obnova nesmie bežať súbežne s aplikáciou. Test obnovy v samostatnom prostredí je súčasťou prevádzkového overenia.

## Čo overiť pred pozvaním účastníkov

- Pri prvom nasadení celý tok `hub.biketrek.sk/zk` → `zk-app:3000/zk`, vrátane POST, query, reloadu deep linku a návratu po prihlásení. Neskôr osobitne aj reťazec `zimnykurz.sk/priprava` → `hub.biketrek.sk/zk` → `zk-app:3000/priprava`.
- Aktívne `APP_URL` sa zhoduje s buildom aj Caddy fragmentom; platné TLS, správny Host/Origin, Secure/HttpOnly cookie a service worker scope používajú aktívny prefix `/zk` alebo `/priprava`.
- Login limity pre dvoch účastníkov, aj po podvrhnutí klientského `X-Forwarded-For` (nesmie obísť limit); pri budúcej verejnej proxy osobitne overené jej IP forwarding pravidlá.
- Prvý admin sa prihlási cez svoju schránku; nepozvaný človek nevidí kurz; odobratý člen stratí prístup aj so starou session.
- Testovací ročník je označený, termíny prípravy sú nastavené pre skutočný kurz a demo dáta sa nezmiešajú s účastníkmi.
- Reálny SMTP login, pozvánka, opätovné odoslanie a expirácia. Vývojová schránka nie je dôkaz doručenia e-mailu.
- Reálny web push na cieľovom Android/iPhone, odmietnutie, odhlásenie a otvorenie správnej správy. Na iPhone/iPade môže byť potrebná inštalácia na plochu a podporovaná verzia systému.
- Reštart kontajnera ponechá aktivity, reakcie, komentáre a oznámenia. Over zálohu/obnovu.
- Hub a SPS ostali dostupné. Ich úspech sa nesmie odvodzovať iba zo stavu nového ZK kontajnera.

## Technické zdroje

- [Node.js 24 SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html) — online backup API.
- [Docker Compose env_file](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/) — raw formát od 2.30.
- [Caddy URI rewriting](https://caddyserver.com/docs/caddyfile/directives/uri) — prefix bez zmeny query.
- [Caddy trusted proxies](https://caddyserver.com/docs/caddyfile/options#trusted-proxies) — bezpečné určenie client IP.
- [nginx proxy module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) — prefixová proxy a TLS.
- [Apache mod_proxy](https://httpd.apache.org/docs/current/mod/mod_proxy.html) — ProxyPass/ProxyPassReverse.
- [Caddy validate a reload](https://caddyserver.com/docs/command-line) — validácia a načítanie konfigurácie.
