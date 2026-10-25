# Cestou Zimy — pravidlá úprav

Prečítaj README.md, docs/PRODUCT.md a docs/GAMIFICATION.md pred zmenou správania. UI je slovenské. Zdroj pravdy je server + SQLite. Registrácia prezývkou a heslom je povolená; nepovinné meno a priezvisko sú súkromné. Ostatní účastníci vidia iba prezývku. Bez platného pozývacieho odkazu nový účet čaká na schválenie. Aktívne členstvo a rolu kontroluj pri každom API. Zachovaj aj voliteľné SMTP/OTP prihlásenie. Cudzie e-maily ani skryté úlohy nesmú odísť účastníkovi. No-store pre súkromné odpovede. Žiadne klientské prepínanie identity, vlastná kryptografia, neaktivita ako trest, zdravotné skóre, rebríčky, pasy, mapy, mena alebo obchod.

Kontroly: `pnpm typecheck`, `pnpm test`, `pnpm build`. Testy používajú izolovanú SQLite a skutočnú Better Auth, nie produkčné údaje. Prehliadačové a fyzické zariadenia uvádzaj iba ak skutočne overené. Pridávaj migrácie, nemen už aplikované SQL. Tajomstvá a runtime súbory necommituj. Pôvodné ilustrácie majú evidovaný zdroj v docs/DESIGN.md. Odmietnuté názvy: nepoužívať názov rappera pre pravidelnosť; používať Pravidelnosť/Pohyb/Sila/Pestrosť/Výbava.

Docker nasadenie je v samostatnom projekte. Caddy zdieľa `inventory-hub-net` s aliasom `zk-app`; zachovaj existujúce Hub/SPS bloky. Bez samostatného súhlasu neupravuj bežiacu produkciu, DNS ani neobjednávaj služby.
