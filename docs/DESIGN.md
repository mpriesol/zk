# Cestou Zimy — overené vizuálne podklady

Overené 25. 10. 2026. Zdroj: https://zimnykurz.sk/. Živý web bol otvorený a vizuálne skontrolovaný v desktopovom prehliadači. Mobilné pravidlá boli preskúmané v skutočnom CSS; samostatný mobilný viewport zatiaľ nebol vizuálne overený.

## Identita a tokeny

- Hlavná farba: `#588d8c`. Pôvodný web ju používa na text, navigáciu, tlačidlá a linky.
- Pozadie: `#ededed` (`body` v pôvodnom CSS).
- Svetlá: `#fefefe`; doplnkové svetlé modré a tyrkysové tóny sú súčasťou originálnych ilustrácií.
- Nadpisy a textový názov značky: **Titillium Web, 600**. Textové logo je „Cestou Zimy“; nevyrábať nové grafické logo.
- Bežný text: **Open Sans, 400**. CSS má pred ním `PT Sans`, ale ten pôvodná stránka nenačítava, preto sa na zariadení bez lokálneho PT Sans uplatňuje Open Sans.
- Geometrické hranaté ilustrácie, jednoduché obdĺžnikové tlačidlá, vzdušné rozostupy. Pôvodný marketingový hero nie je vhodné kopírovať do denníka.
- Pôvodný teal na svetlom pozadí má slabší kontrast pre drobný text; pre aplikáciu je vhodná tmavšia odvodená textová farba, pôvodný teal zostáva hlavnou značkovou farbou.

Zdrojové CSS: https://zimnykurz.sk/css/main.css?v=20191013 (lokálne `main.css`). Nadpisy riadok ~2578, telo ~213, header ~7842.

## Originálne obrázky

| Lokálny súbor | Presný pôvod | Využitie |
|---|---|---|
| `hory_title_complete.png` | https://zimnykurz.sk/images/hory_title_complete.png | Pôvodná geometrická zimná ilustrácia, 1178 × 708. Vhodná nanajvýš ako malý dekoratívny motív. |
| `stromky_s_macom.gif` | https://zimnykurz.sk/images/stromky_s_macom.gif | **Pôvodný strom so schovaným zvieratkom**, 166 × 235. Dva snímky: 6000 ms skryté, 1500 ms vykuknuté. |
| `original-frame-0.png` | Presná dekódovaná snímka 0 uvedeného GIF | Pokojový stav, zvieratko schované. Bez prekresľovania alebo generovania. |
| `original-frame-1.png` | Presná dekódovaná snímka 1 uvedeného GIF | Vykuknuté zvieratko spoza pravej strany stromu. Bez prekresľovania alebo generovania. |
| `logo-plusko.png` | https://zimnykurz.sk/images/logo-plusko.png | Pôvodné logo organizátora Plusko, nie nové logo aplikácie. |
| `favicon.ico` | https://zimnykurz.sk/favicon.ico | Pôvodná favicon. |
| `icon.svg`, `icon-192.png`, `icon-512.png` | Lokálny SVG obal obsahujúci nezmenenú pôvodnú snímku 0 | Štvorcová PWA ikona na `#ededed`. PNG sú build výstupy SVG cez sharp, nie nové logo. |

Poznámka k názvu: pôvodný web súbor nazýva `stromky_s_macom.gif`; zadanie označuje postavičku ako veveričku. Používa sa presne pôvodná postavička, žiadna náhrada alebo emoji.

V načítanom HTML/CSS nebola nájdená výslovná otvorená licencia na ilustrácie ani určenie konkrétneho autora. Assety sú použité na výslovnú požiadavku organizátora pre pokračovanie rovnakého projektu. Zachovať pôvod a neprezentovať ich ako vlastné dielo ani voľne licencované zdroje; práva na ďalšiu distribúciu mimo tohto projektu nie sú týmto overené.

## Implementácia veveričky

Nespúšťať originálny nekonečne opakovaný GIF v rozhraní. Komponent prepína medzi dvoma statickými snímkami na základe potvrdenej udalosti. Tým sa zachová presné vizuálne vykuknutie spoza stromu a animácia rešpektuje frekvenciu, vypnutie animácií aj reduced motion.

- Pokojový stav: `original-frame-0.png`.
- Udalosť: prepnúť na `original-frame-1.png` na približne 1500–2500 ms; bublina môže zostať 5–7 s, s možnosťou otvorenia obsahu.
- Bez syntetického pohybu celého stromu. Pôvodná animácia je jednoduchá dvojstavová.
- Maximum 2 automatické udalosti za reláciu; ID zobrazených udalostí uchovávať podľa kurzu a používateľa, nikdy globálne medzi účtami.
- Skupinové získanie odmien zobraziť jedným vystúpením.
- Pri formulári a na mobilnej klávesnici úplne skryť komponent.
- `prefers-reduced-motion` alebo vypnuté animácie: pokojový strom, správa dostupná štandardne v centre oznámení/odmien.
- Bublina nesmie brať focus; ovládanie odkazu musí byť dostupné klávesnicou.

## Písma

Pôvodný HTML načítava:
`https://fonts.googleapis.com/css?family=Titillium+Web:600|Open+Sans&subset=latin,latin-ext`

Lokálna odpoveď je `fonts.css`. Fonty je vhodné používať lokálne pre stabilitu a bez požiadaviek na Google pri každej návšteve. Originálne URL pre fonty:

- Open Sans: https://fonts.gstatic.com/s/opensans/v44/memSYaGs126MiZpBA-UvWbX2vVnXBbObj2OVZyOOSr4dVJWUgsjZ0B4uaVc.ttf
- Titillium Web 600: https://fonts.gstatic.com/s/titilliumweb/v19/NaPDcZTIAOhVxoMyOr9n_E7ffBzCGIVzZg.ttf

Licencie SIL Open Font License sú získané z oficiálneho repozitára Google Fonts. Zachovať súbory licencií pri redistribúcii fontov.

## Responzívna referencia

Pôvodný web používa hranicu 40em (640px) a 64em (1024px). Pod 640px sa navigácia zbalí, obsah je v jednom stĺpci, titulok má 3rem. Aplikácia má zachovať vizuálnu identitu, ale používať kompaktnú spodnú navigáciu a hlavný úkon dostupný bez scrollovania. Mobilný viewport aplikácie treba otestovať osobitne.
