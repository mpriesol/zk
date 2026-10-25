# Upozornenia a PWA

Web push je dobrovoľný kanál. Centrum oznámení je hlavný zdroj správ a nevyžaduje povolenie prehliadača. Zapnutie sa vykoná iba po kliknutí na tlačidlo. Zamietnutie nespustí ďalší automatický dialóg.

## Konfigurácia

Server potrebuje `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` a `VAPID_SUBJECT` (`mailto:...` kontakt organizátora alebo HTTPS kontaktná stránka). Public key je jediný kľúč, ktorý môže dostať klient. Používa sa balík `@block65/webcrypto-web-push` v2 s Web Crypto, RFC 8291 `aes128gcm` a RFC 8292 VAPID. Nevyvíjame vlastnú kryptografiu. Privátny kľúč patrí do runtime secrets a nesmie byť v Gite.

Kľúče sa dajú vytvoriť štandardným Node Web Crypto API (ECDSA P-256). Raw public key kóduj base64url; private key je JWK `d`. Pri zmene páru treba zariadenia opäť prihlásiť. VAPID nevyžaduje platenú službu.

Predvolené pozvánky odosiela rovnaký SMTP transport ako prihlasovacie kódy; runtime dodáva `invitationSender` callback. Úspech znamená prijatie SMTP serverom, nie doručenie do schránky. Stabilné Message-ID môže pomôcť pri duplicitách, SMTP však neposkytuje garantované idempotentné doručenie.

Alternatívne odoslanie pozvánky cez Resend vyžaduje `RESEND_API_KEY`, `EMAIL_FROM` s overenou doménou a `SITE_URL`. Kód posiela textovú transakčnú pozvánku s idempotency key; žiadne hromadné motivačné e-maily. Bez týchto hodnôt je členstvo možné pripraviť, ale odoslanie e-mailu sa nesmie označiť za úspešné. Reálne doručovanie a spamové filtre sa musia overiť s účtom organizátora.

## Bezpečnosť a správanie

- Odber patrí prihlásenému členovi. `pushStatus` kontroluje vlastníctvo endpointu; samotný odber v prehliadači nie je úspešné serverové prihlásenie.
- Server prijíma HTTPS endpointy iba dôveryhodných push služieb Google, Mozilla, Apple a Microsoft, bez credentials, fragmentu a neštandardného portu. Odchádzajúce presmerovanie sa zamietne.
- Server vracia `accepted` (prijaté poskytovateľom), `expired` (404/410), `retry` (dočasná chyba/rate limit) alebo `failed` (trvalé zlyhanie). `accepted` neznamená garantované doručenie, zobrazenie ani prečítanie.
- `drainOutbox` drží outbox v DB, atomicky získava päťminútový lease a obnoví spracovanie po páde. Ukladá prijatie samostatne pre každé zariadenie, odstraňuje expired odbery a opakuje dočasné chyby najviac osemkrát s exponenciálnym odstupom. Node runtime ho spúšťa každých 30 sekúnd nezávisle od otvorenej stránky. Nové zariadenie nedostane push za starú už spracovanú správu.
- Pri páde medzi prijatím poskytovateľom a zápisom potvrdenia do DB alebo strate HTTP odpovede nemožno garantovať presne jedno externé doručenie. Stabilný tag zoskupí rovnaké oznámenie na zariadení; potvrdené zariadenia sa pri opakovaní neposielajú znovu.
- Predvolený push obsah je všeobecný, aby na zamknutej obrazovke nezobrazoval súkromný text správy. Kliknutie otvorí konkrétnu správu; autorizáciu opäť kontroluje API. Cudzí účet obsah nedostane.
- `disconnectPush()` najprv vypne odber zariadenia, potom žiada server o odstránenie. UI ho používa pred odhlásením; pri výpadku sa vypnutý endpoint neskôr odstráni aj po 410.
- Service worker nemá fetch cache ani offline zápisy. Neukladá súkromné stránky/API odpovede. Upozornenia sa pri odhlásení zatvoria.
- Obnovenie neplatného odberu vyžaduje nové vedomé potvrdenie používateľa, nie tiché prihlásenie iného účtu.

## Prehliadače a pridanie na plochu

Overené v oficiálnej dokumentácii 25. 10. 2026: iOS/iPadOS podporuje web push od 16.4 pre webové aplikácie pridané na plochu. Povolenie musí nasledovať po interakcii používateľa. Manifest má `display: standalone`, `id`, scope a lokálne ikony odvodené z originálnej ilustrácie. Safari na macOS a prehliadače s Push API používajú štandardnú subscription; aplikácia vždy zisťuje dostupné API, nespolieha sa len na názov prehliadača. Android Chrome/Edge umožňuje inštaláciu cez menu prehliadača. HTTPS je potrebné mimo localhost vývoja.

Zdroje:

- https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
- https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push
- https://github.com/block65/webcrypto-web-push/tree/master/packages/web-push

## Testovanie

`tests/outbox.test.ts` používa reálnu izolovanú SQLite DB a overuje súbežné claimovanie, retry iba nedokončených zariadení, zrušené členstvo/adresáta, expired odstránenie, obnovu lease, limit pokusov a idempotentné e-mailové volanie.

`tests/push.test.ts` overuje skutočné vytvorenie šifrovaného aes128gcm/VAPID requestu s generovanými P-256 kľúčmi a stubom HTTP transportu. Testuje aj validáciu endpointov, expired/rate-limit/network správanie, bezpečné otvorenie odkazu a službu pozvánok. Service worker sa vykoná v izolovanom JS kontexte s modelovanými browser API. Tieto testy nedokazujú doručenie na telefón.

Pred produkčným použitím vykonaj na skutočnom Android telefóne a iPhone: odmietnutie povolenia → funkčné in-app správy; vedomé zapnutie → odoslanie adminom → otvorenie správneho oznámenia; odhlásenie → bez ďalšieho upozornenia; odstránenie appky/odberu → expired odstránenie; opakované odoslanie rovnakého oznámenia → bez duplikátu v aplikácii. Emulovaný mobilný rozmer nie je test Safari/iPhone push.

## Adresa aplikácie a presun medzi nasadeniami

Jediné nastavenie `APP_URL` určuje adresu a prefix buildu aj servera:

| Etapa | APP_URL | Scope service workera |
|---|---|---|
| Prvé funkčné nasadenie | `https://hub.biketrek.sk/zk` | `/zk/` |
| Neskorší presun pod web kurzu | `https://zimnykurz.sk/priprava` | `/priprava/` |

Po zmene `APP_URL` znovu vytvor frontend build a reštartuj aplikáciu. Manifest `id`, `start_url`, `scope` a ikony vytvára `scripts/pwa-assets.mjs` podľa vybranej adresy. Node server vracia manifest so scope aktuálneho nastavenia; rovnaký service worker odvodzuje prefix zo svojho `registration.scope`. API, obrázky, odhlasovanie odberu aj odkazy v notifikáciách používajú zodpovedajúci prefix. Proxy musí na tejto ceste vracať skutočný JavaScript service workera, manifest JSON a obrázky, nie prihlasovaciu HTML stránku ani presmerovanie na inú doménu. Scope nezahŕňa existujúcu stránku na `/`; kliknutie na upozornenie neprepíše jej otvorené okno.

Odber patrí konkrétnemu originu a scope. Server pri uložení odberu pridá vlastné `applicationUrl`; údaj od klienta sa nepoužíva. Po zmene domény **alebo prefixu** sa staré odbery považujú za neplatné pre nové nasadenie a pred odoslaním sa odstránia. Starý worker nikdy nedostane odkaz z novej adresy. Používateľ musí otvoriť novú adresu a vedome znova zapnúť upozornenia. In-app správy a ostatné dáta ostávajú zachované. Rovnako sa odmietnu staré odbery bez metadát adresy.

Na Safari/iPhone nainštaluj aplikáciu z aktuálneho `APP_URL` a povoľ upozornenia v nainštalovanej aplikácii. Odber z inej domény alebo vývojového náhľadu sa neprenáša. Po presune môžeš starú ikonu odstrániť a pridať novú. Bez živého HTTPS proxy a testovacieho zariadenia zostáva reálne doručenie neoverené.
