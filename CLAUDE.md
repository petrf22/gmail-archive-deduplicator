# CLAUDE.md

Tento soubor slouží jako vodítko pro Claude Code (claude.ai/code) při práci s kódem v tomto repozitáři.

## Projekt

Doplněk pro Thunderbird (MailExtension, Manifest V2, Thunderbird ≥ 102). Hledá emaily z lokální archivní složky, které jsou zároveň v Gmail „All Mail“ (IMAP), a jejich Gmail kopie přesouvá do Gmail koše. Lokální archiv nikdy nemění. UI, komentáře v kódu, dokumentace i commit zprávy jsou česky. S uživatelem komunikuj také česky.

## Build a spuštění

- `./build.sh` (Linux/Mac) nebo `build.bat` (Windows) zabalí `src/` do `gmail-archive-deduplicator.xpi` v kořeni repozitáře. Do balíčku jdou jen `manifest.json`, `background.js`, `popup.html`, `popup.js` a `icons/`. Nový zdrojový soubor je proto nutné přidat do obou skriptů.
- Nejsou tu testy, linter ani npm. Testuje se ručně v Thunderbirdu: Doplňky (Ctrl+Shift+A) → ozubené kolo → Debug Add-ons → Load Temporary Add-on → `src/manifest.json`. Logy najdeš v Nástroje → Vývojářské nástroje → Browser Console, případně přes Inspect u background stránky doplňku.
- Při každé změně chování zvyš `version` v `src/manifest.json`. Popup zobrazuje verzi v titulku (čte ji přes `runtime.getManifest()`).

## Architektura

Doplněk má dva kontexty. Komunikují spolu výhradně zprávami přes `messenger.runtime`:

- **`src/popup.js` / `popup.html`** tvoří UI. Otevírá se jako browser_action popup, nebo jako samostatné okno z položky v menu Nástroje, kterou registruje `background.js`. UI vypíše všechny složky: účty typu `none` bere jako lokální, účty typu `imap` jako Gmail. Pravděpodobné složky předvybere podle jména a posílá tyto zprávy:
  - `{action:'findDuplicates', folderRefs:{archiveFolder, gmailAllMail}}`
  - `{action:'moveDuplicates', duplicateIds:[id Gmail zpráv], gmailTrash}`, odpověď `{success, stopped, movedIds}`

  Složky se předávají jako `{accountId, path}`. Samotná `path` není napříč účty unikátní (např. `/Trash` je v lokálních složkách i v IMAP).
  - `{action:'stop'}`, který se posílá i při `beforeunload`, pokud nějaká operace běží
- **`src/background.js`** obsahuje veškerou logiku práce s poštou. Průběh posílá zpět přes `sendProgress()` jako `{action:'progress', message}`. Když žádný popup není otevřený, chybu ignoruje.

Postup hledání duplicit (`findDuplicates`):
1. Najde složky přes `findFolder({accountId, path})`. Když je nedostane, detekuje je automaticky podle jména (`findLocalArchiveFolder` apod.).
2. Paralelně načte archiv (včetně podsložek, do šířky, `getAllMessagesFromFolderFast`) a Gmail All Mail (bez podsložek, `loadGmailMessages`). Obojí stránkuje přes `messages.list`/`continueList`.
3. `indexGmailMessages` sestaví dvě mapy: `byMessageId` (z `headerMessageId`, který už je v `MessageHeader`; nevolej `messages.getFull`, u IMAP stahuje celé zprávy) a `byHash` (`subject|dateMs|author`, hash je `null`, pokud něco z toho chybí).
4. `findDuplicatesInArchive` páruje primárně podle Message-ID. Hash se použije **jen** když Message-ID chybí na jedné ze stran, protože dvě zprávy s různým Message-ID nejsou duplicity. Přes `processedGmailIds` zajistí, že se žádná Gmail zpráva nespáruje dvakrát.

Zastavení: modulový příznak `stopState.requested` v `background.js`. Zpráva `stop` ho nastaví, každý nový `findDuplicates`/`moveDuplicates` ho vynuluje. Dlouhé smyčky ho kontrolují mezi stránkami či dávkami a vyhazují `'Operace zastavena uživatelem'`. Výjimkou je `moveDuplicatesToTrash`, která místo výjimky vrací `{stopped, movedCount}`. I každá nová dlouhá smyčka musí `stopState.requested` kontrolovat.

## Na co si dát pozor

- `moveDuplicatesToTrash` musí dostat koš vybraný uživatelem (`gmailTrash`). Automatická detekce (`findGmailTrashFolder`) je jen fallback. Přesouvá po dávkách a vrací `movedIds`, podle kterých popup aktualizuje seznam.
- Markdown dokumentace (`INSTALACE.md`, `POKROCILE.md`, `OBSAH-BALICKU.md`) vznikla na začátku projektu a je částečně zastaralá. Odkazuje na konkrétní čísla řádků a zmiňuje soubory, které už neexistují. Platí kód, ne tyto dokumenty.
