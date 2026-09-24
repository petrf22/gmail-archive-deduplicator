# CLAUDE.md

Tento soubor slouží jako vodítko pro Claude Code (claude.ai/code) při práci s kódem v tomto repozitáři.

## Projekt

Doplněk pro Thunderbird (MailExtension, Manifest V2, Thunderbird ≥ 102). Hledá emaily z lokální archivní složky, které jsou zároveň v Gmail „All Mail“ (IMAP), a jejich Gmail kopie přesouvá do Gmail koše. Lokální archiv nikdy nemění. UI, komentáře v kódu, dokumentace i commit zprávy jsou česky. S uživatelem komunikuj také česky.

## Build a spuštění

Zdrojáky jsou v TypeScriptu (`src/*.ts`). esbuild je bundluje do `dist/` jako IIFE (bez modulů, protože manifest je načítá jako klasické skripty). `manifest.json`, `popup.html` a `icons/` se kopírují beze změny.

- `npm run typecheck`: `tsc` (strict, noEmit). Jiná automatická kontrola tu není, testy ani linter nejsou.
- `npm run build`: typecheck a sestavení do `dist/` (`scripts/build.mjs`)
- `npm run watch`: esbuild watch (statické soubory se při změně nekopírují)
- `npm run package`: build a pak `web-ext build` do `gmail-archive-deduplicator.xpi` v kořeni repozitáře
- Testuje se ručně v Thunderbirdu: Doplňky (Ctrl+Shift+A) → ozubené kolo → Debug Add-ons → Load Temporary Add-on → `dist/manifest.json`. Logy najdeš v Nástroje → Vývojářské nástroje → Browser Console, případně přes Inspect u background stránky doplňku.
- Při každé změně chování zvyš `version` v `src/manifest.json` (a v `package.json`). Popup zobrazuje verzi v titulku.
- Typy WebExtension API pro Thunderbird jsou z `@types/thunderbird-webext-browser` (globální namespace `messenger`).

## Architektura

Doplněk má dva kontexty. Komunikují spolu výhradně zprávami přes `messenger.runtime`. Protokol je typovaný v `src/types.ts`: `BackgroundRequest` je discriminated union podle `action` a `ResponseFor` přiřazuje ke každé akci typ odpovědi. Popup posílá požadavky přes typovaný helper `send()`, background je zpracovává v `handleRequest()` a odpovídá vráceným Promise.

- **`src/popup.ts` / `popup.html`** tvoří UI. Otevírá se jako browser_action popup, nebo jako samostatné okno z položky v menu Nástroje, kterou registruje background. UI vypíše všechny složky: účty typu `none` bere jako lokální, účty typu `imap` jako Gmail. Pravděpodobné složky předvybere podle jména a posílá tyto zprávy:
  - `findDuplicates` s `folderRefs:{archiveFolder, gmailAllMail}`
  - `moveDuplicates` s `duplicateIds` a `gmailTrash`, odpověď `{success, stopped, movedIds}`
  - `stop`, který se posílá i při `beforeunload`, pokud nějaká operace běží
- **`src/background.ts`** obsahuje veškerou logiku práce s poštou. Průběh posílá zpět přes `sendProgress()` jako `{action:'progress', message}`. Když žádný popup není otevřený, chybu ignoruje.

Složky se předávají jako `FolderRef` = `{accountId, path}`, protože samotná `path` není napříč účty unikátní (např. `/Trash` je v lokálních složkách i v IMAP). `accounts.list`/`get` volej s `true`, jinak novější Thunderbird složky nevrací.

Postup hledání duplicit (`findDuplicates`):
1. Najde složky přes `findFolder({accountId, path})`. Když je nedostane, detekuje je automaticky podle jména (`findLocalArchiveFolder` apod.).
2. Paralelně načte archiv (včetně podsložek, do šířky, `getAllMessagesFromFolderFast`) a Gmail All Mail (bez podsložek, `loadGmailMessages`). Obojí stránkuje přes `messages.list`/`continueList`.
3. `indexGmailMessages` sestaví dvě mapy: `byMessageId` (z `headerMessageId`, který už je v `MessageHeader`; nevolej `messages.getFull`, u IMAP stahuje celé zprávy) a `byHash` (`subject|dateMs|author`, hash je `null`, pokud něco z toho chybí).
4. `findDuplicatesInArchive` páruje primárně podle Message-ID. Hash se použije **jen** když Message-ID chybí na jedné ze stran, protože dvě zprávy s různým Message-ID nejsou duplicity. Přes `processedGmailIds` zajistí, že se žádná Gmail zpráva nespáruje dvakrát.

Zastavení: modulový příznak `stopState.requested` v `background.js`. Zpráva `stop` ho nastaví, každý nový `findDuplicates`/`moveDuplicates` ho vynuluje. Dlouhé smyčky ho kontrolují mezi stránkami či dávkami a vyhazují `'Operace zastavena uživatelem'`. Výjimkou je `moveDuplicatesToTrash`, která místo výjimky vrací `{stopped, movedCount}`. I každá nová dlouhá smyčka musí `stopState.requested` kontrolovat.

## Na co si dát pozor

- `moveDuplicatesToTrash` musí dostat koš vybraný uživatelem (`gmailTrash`). Automatická detekce (`findGmailTrashFolder`) je jen fallback. Přesouvá po dávkách a vrací `movedIds`, podle kterých popup aktualizuje seznam.
- Markdown dokumentace (`INSTALACE.md`, `POKROCILE.md`, `OBSAH-BALICKU.md`) vznikla na začátku projektu a je částečně zastaralá. Odkazuje na konkrétní čísla řádků a zmiňuje soubory, které už neexistují. Platí kód, ne tyto dokumenty.
