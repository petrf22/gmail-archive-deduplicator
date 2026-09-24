---
name: run-gmail-archive-deduplicator
description: Sestavení, spuštění a ovládání doplňku Gmail Archive Deduplicator pro Thunderbird. Použij, když máš doplněk spustit (run/start), sestavit (build), otestovat (test), udělat screenshot popupu, ovládat ho ve skutečném Thunderbirdu nebo ověřit změnu v background.ts či popup.ts.
---

Doplněk se ovládá přes `.claude/skills/run-gmail-archive-deduplicator/driver.mjs`. Driver má tři vrstvy:
`bg` spouští `dist/background.js` v Node s falešným `messenger` API, `ui` pouští popup v headless
Chrome přes CDP a `tb` spouští **skutečný Thunderbird headless** s dočasným profilem a ovládá ho přes Remote Debugging Protocol.
Žádná vrstva nesahá na skutečný profil `~/.thunderbird` ani na Gmail.

Všechny cesty jsou relativní ke kořeni repozitáře.

## Prerekvizity

Stačí Node ≥ 20 (`web-ext` 10 to vyžaduje; ověřeno na Node 24, který má vestavěný `WebSocket`, a ten driver
potřebuje pro CDP). Pro `ui` je potřeba `google-chrome` (nebo `chromium`) v PATH, pro `tb` `thunderbird`
v PATH (ověřeno na 153.3.1esr). Xvfb **není potřeba**: Thunderbird běží s `MOZ_HEADLESS=1` a screenshoty se dělají přes `drawSnapshot`.

```bash
npm install
```

## Build

```bash
npm run build        # tsc + esbuild -> dist/
```

Driver čte `dist/`, takže po každé změně v `src/` spusť build znovu.

## Run (agent path)

```bash
D=.claude/skills/run-gmail-archive-deduplicator/driver.mjs
node $D bg all       # logika backgroundu: 6 scénářů, exit 1 při selhání (~1 s)
node $D ui           # popup v headless Chrome: načtení -> hledání -> přesun, 3 screenshoty (~3 s)
node $D tb           # skutečný Thunderbird: instalace, reparse mboxů, popup, hledání, přesun (~15 s)
```

Screenshoty se ukládají do `/tmp/gad-shots/` (jiný adresář nastavíš přes `--out <adresář>`). Vždy se na ně podívej (Read na PNG).

| příkaz | co dělá |
|---|---|
| `bg [scénář\|all]` | scénáře `detect`, `refs`, `refs-trash`, `move`, `stop-scan`, `stop-move`. Vypíše odpověď a výsledek OK nebo FAIL. |
| `send '<json>'` | pošle backgroundu libovolný `BackgroundRequest` a vypíše progress zprávy, odpověď a volání `messages.move` |
| `ui` | projde celý flow v popupu. Varianty: `--stop --page-delay 300` (klikne na Zastavit), `--fail-move 102` (selhání přesunu), `--size 650x800`, `--eval '<js>'` (vyhodnotí JS po načtení, udělá screenshot a skončí) |
| `tb` | stejný flow ve skutečném TB 153 a navíc porovnání výsledků s fake API. Varianty: `--keep-profile` (profil se nesmaže, cesta se vypíše), `--verbose` (stderr TB) |

Společné volby: `--fixture <json>`, `--page-delay <ms>`, `--move-delay <ms>`, `--fail-move <id,id>`.

Testovací data jsou ve `fixture.json`. Lokální účet (`none`) obsahuje `/Archives` s podsložkou `/Archives/2024`, `/Trash` a `/Inbox`.
Gmail účet (`imap`) obsahuje `/[Gmail]/All Mail` (6 zpráv a 250 výplňových kvůli stránkování po 100) a `/[Gmail]/Trash`.
Očekávané duplicity jsou Gmail id 101, 102 a 106. Komentář `_comment` ve fixture vysvětluje, proč ostatní zprávy duplicitami nejsou.

**Kterou vrstvu použít:** Změna párování, stopu nebo přesunu v `background.ts` → `bg all` (případně přidej scénář do `scenarios` v driveru).
Změna v `popup.ts` nebo `popup.html` → `ui` a prohlédnout screenshoty. Před odevzdáním větší změny nebo při podezření,
že se skutečné API chová jinak než fake → `tb`.

Mapování ve `tb`: Thunderbird tu nemá IMAP server, proto se Gmail složky z fixture zapíšou jako lokální mboxy
`/Gmail All Mail` a `/Gmail Trash` v Místních složkách. Driver je do Gmail výběrů v popupu doplní klonem `<option>`
(se stejným `data-folder-data`) s popiskem „(náhrada Gmailu)“. Popup otevírá přes `messenger.windows.create`,
stejně jako položka v menu Nástroje, a ovládá ho z background stránky přes `messenger.extension.getViews()`.

## Run (human path)

```bash
npm run build   # pak v Thunderbirdu: Doplňky (Ctrl+Shift+A) -> ozubené kolo -> Debug Add-ons
                # -> Load Temporary Add-on -> dist/manifest.json
```

Pozor: tohle se instaluje do tvého skutečného profilu s napojeným Gmailem, takže „Přesunout do koše“ přesouvá doopravdy.

## Test

Testy ani linter v projektu nejsou. Kontrola se skládá z těchto kroků:

```bash
npm run typecheck
node .claude/skills/run-gmail-archive-deduplicator/driver.mjs bg all   # "Všech 6 scénářů prošlo", exit 0
node .claude/skills/run-gmail-archive-deduplicator/driver.mjs tb       # samé OK, exit 0
```

`ui` nemá vlastní pass/fail. Kontroluje se výpis `status:` a screenshoty.

## Gotchas

- **Thunderbird zprávě bez hlavičky `Message-ID` vygeneruje `headerMessageId: "md5:…"`** (ověřeno na TB 153).
  Prázdné ID tak nikdy nepřijde a hash větev ve `findDuplicatesInArchive`
  (`!messageId || !getMessageId(candidate)`) se se skutečným TB nikdy nepoužije. Fake API to napodobuje
  (`syntheticMessageId`), jinak by `bg` hlásil o duplicitu víc než skutečnost (4 místo 3).
- **Názvy speciálních složek jsou lokalizované.** `/Archives` má ve skutečném TB `name: "Archiv"`. Složky proto hledej podle `path`, ne podle `name`.
- **mbox bez `.msf` se nezaindexuje, dokud se složka neotevře v UI.** `messages.list` do té doby vrací 0 zpráv.
  `tb` proto v parent procesu volá `folder.updateFolder(null)` a čeká, až `getTotalMessages` sedí.
- **TB 153 na deskriptoru doplňku nepodporuje RDP `getTarget`** (jen `reload`, `terminateBackgroundScript`, `reloadDescriptor` a `getWatcher`).
  Konzole background stránky se získá přes `getWatcher` → `watchTargets {targetType:'frame'}`.
  První `target-available-form` je „Web Extension Fallback Document“, na kterém `messenger` neexistuje. Je potřeba počkat na target s URL `moz-extension://…/_generated_background_page.html`.
- **`evaluateJSAsync` nečeká na Promise**, vrací jen grip `Promise {pending}`. Driver proto výsledek ukládá do globálu a dotazuje se na něj (`rdp.evaluate`). Dlouhé řetězce (screenshot v data URL) chodí jako `longString` a stahují se přes `substring`.
- **RDP klient z `web-ext` se tu nedá použít:** událost `evaluationResult` nezná a hlásí ji jako chybu, navíc balíček exportuje jen `.`. Proto má driver vlastní klienta o 40 řádcích.
- **Globál `MailServices` už v konzoli parent procesu existuje.** `ChromeUtils.importESModule(...MailServices...)` tam spadne na `redeclaration of non-configurable global property`.
- **`confirm()` v popupu je třeba přepsat** (`ui` v prohlížeči, `tb` přes `view.confirm`). Skutečný modální dialog by zablokoval CDP i RDP.
- **Popup v okně 650×500** (velikost z `windows.create`) má seznam duplicit skoro celý pod okrajem okna, a to v Chrome i ve skutečném TB (screenshot `02-duplicates.png`). Pro kontrolu seznamu použij `ui --size 650x800`.
- **Stop během hledání:** výsledná stavová zpráva bývá `⏹ Načítání Gmail zastaveno…` s třídou `loading`, ne `Chyba: Operace zastavena…`.
  Druhý paralelní loader pošle progress až po odpovědi a přepíše ji. Tak se chová samotný doplněk, ne harness.
- **Mezi Node a prohlížečem je vždy `structuredClone`**, stejně jako ve skutečném `runtime.sendMessage`. `date` tedy zůstává `Date`.
- V `bg move` se do konzole vypíše `console.error` se stack trace („Chyba při přesunu dávky…“). To je očekávané, scénář selhání přesunu simuluje schválně.

## Troubleshooting

- **`dist/background.js neexistuje`**: spusť `npm run build`.
- **`Timeout: načtení a předvýběr složek` (ui)**: popup.js spadl ještě před načtením složek. Výjimky se vypisují jako `[výjimka] …` a konzole stránky jako `[console.*]`.
- **`RDP port … neodpovídá` (tb)**: Thunderbird nenastartoval. Spusť `tb --verbose`, ať vidíš jeho stderr. Při headless startu se běžně vypisují hlášky `Gtk-CRITICAL … GDK_IS_SCREEN`, ty jsou neškodné.
- **Po přerušeném `tb` (Ctrl-C) nebo `ui` zůstávají procesy nebo dočasné adresáře**: `pkill -f gad-tb-profile-`, `pkill -f gad-chrome-`, `rm -rf /tmp/gad-tb-profile-* /tmp/gad-chrome-*`.
