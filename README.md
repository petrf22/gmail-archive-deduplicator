# Gmail Archive Deduplicator - Doplněk pro Thunderbird

Tento doplněk automaticky detekuje a odstraňuje duplicitní emaily mezi lokálním archivem a Gmail účtem.

## Funkce

- ✅ Výběr lokálního archivu, Gmail „All Mail“ a Gmail koše (pravděpodobné složky se předvyberou podle jména)
- ✅ Porovnání emailů pomocí Message-ID, u zpráv bez Message-ID podle předmětu, data a odesílatele
- ✅ Přehledný seznam duplicit s možností výběru
- ✅ Bezpečný přesun do vybraného Gmail koše
- ✅ Tlačítko Zastavit pro hledání i přesun
- ✅ České rozhraní

## Požadavky

- Mozilla Thunderbird verze 102 nebo vyšší
- Nakonfigurovaný Gmail účet (IMAP)
- Lokální archivní složka s emaily

## Instalace

### Metoda 1: Instalace z balíčku (doporučeno)

1. Stáhněte soubor `.xpi` z releases
2. V Thunderbirdu otevřete **Menu** → **Add-ons and Themes** (Ctrl+Shift+A)
3. Klikněte na ikonu ozubeného kola → **Install Add-on From File**
4. Vyberte stažený `.xpi` soubor
5. Potvrďte instalaci

### Metoda 2: Instalace z vývojářského režimu (pro testování)

1. Stáhněte celou složku s doplňkem a sestavte ho: `npm install` a `npm run build`
2. V Thunderbirdu otevřete **Menu** → **Add-ons and Themes** (Ctrl+Shift+A)
3. Klikněte na ikonu ozubeného kola → **Debug Add-ons**
4. Klikněte na **Load Temporary Add-on**
5. Vyberte soubor `dist/manifest.json`

## Použití

1. Klikněte na ikonu doplňku v panelu nástrojů Thunderbirdu, nebo ho otevřete v samostatném okně z menu **Nástroje → Gmail Archive Deduplicator**
2. Zkontrolujte vybrané složky (lokální archiv, Gmail „All Mail“ a Gmail koš) a klikněte na tlačítko **"Vyhledat duplicity"**
3. Počkejte na dokončení analýzy (může trvat několik minut u velkých mailboxů), tlačítkem **Zastavit** ji můžete přerušit
4. Zkontrolujte seznam nalezených duplicit
5. Odškrtněte emaily, které nechcete smazat (volitelné)
6. Klikněte na **"Přesunout vybrané do koše"**
7. Potvrďte akci

## Jak to funguje

Doplněk provádí následující kroky:

1. **Výběr složek**: Použije složky vybrané v okně doplňku (pravděpodobné se předvyberou podle jména)
2. **Načtení emailů**: Načte emaily z archivu (včetně podsložek) a z Gmail „All Mail“
3. **Porovnání**: Pro každý email v lokálním archivu zkontroluje, zda existuje v Gmail
   - Primárně používá Message-ID (unikátní identifikátor emailu)
   - Kombinaci předmětu, data a odesílatele použije jen tehdy, když Message-ID chybí aspoň na jedné straně. Dvě zprávy s různým Message-ID se nikdy nespárují
4. **Zobrazení duplicit**: Vypíše všechny nalezené duplicity
5. **Přesun**: Po potvrzení přesune vybrané emaily do vybraného Gmail koše

## Co doplněk NEDĚLÁ

- **Nemaže lokální archiv**: Duplicitní emaily zůstávají v lokálním archivu
- **Pouze Gmail**: Přesouvá duplicity pouze v Gmail účtu (do koše)
- **Nevyhledává automaticky**: Musíte spustit analýzu manuálně

## Poznámky

### Bezpečnost
- Doplněk pouze přesouvá emaily do koše, trvale nic nemaže
- Z Gmail koše můžete emaily obnovit do 30 dnů
- Doporučujeme před použitím vytvořit zálohu

### Výkon
- Analýza může trvat několik minut u velkých mailboxů

### Předvýběr složek
Okno doplňku nabízí lokální složky (účty typu „Místní složky“) a složky IMAP účtů. Předvybere tyto názvy:
- **Lokální archiv**: "Archives", "Archiv", "Archive"
- **Gmail All Mail**: "[Gmail]/All Mail", "All Mail", "[Gmail]/Všechny zprávy", "[Gmail]/Všechna pošta"
- **Gmail Koš**: "[Gmail]/Trash", "Trash", "[Gmail]/Koš", "Koš"

## Řešení problémů

### Doplněk nenabízí Gmail složky
- Zkontrolujte, že máte nakonfigurovaný Gmail účet přes IMAP (jiné typy účtů se v Gmail výběru nezobrazují)
- Ověřte, že složka "All Mail" je viditelná v Thunderbirdu
- Zkuste restartovat Thunderbird

### Analýza trvá příliš dlouho
- To je normální u velkých mailboxů (10 000+ emailů)
- Zkuste omezit počet emailů v archivu
- Buďte trpěliví - analýza může trvat i 10-15 minut

### Některé duplicity nejsou nalezeny
- Doplněk spoléhá na Message-ID nebo kombinaci metadat
- Pokud jsou metadata změněna, email nemusí být detekován
- To je normální chování pro ochranu proti falešným pozitivům

## Struktura souborů

```
gmail-archive-deduplicator/
├── src/
│   ├── manifest.json      # Konfigurace doplňku
│   ├── background.ts      # Hlavní logika detekce duplicit
│   ├── popup.html         # Uživatelské rozhraní
│   ├── popup.ts           # Logika UI
│   ├── types.ts           # Sdílené typy (zprávy mezi popup a background)
│   └── icons/             # Ikony doplňku
├── scripts/build.mjs      # Sestavení do dist/ (esbuild)
├── package.json
└── tsconfig.json
```

## Sestavení (TypeScript)

Vyžaduje Node.js 20+.

```bash
npm install
npm run build      # kontrola typů + sestavení do dist/
npm run package    # build + zabalení do gmail-archive-deduplicator.xpi
npm run typecheck  # jen kontrola typů
npm run watch      # průběžné sestavování při změnách .ts
```

## Vývoj

Pro úpravu kódu:
1. Upravte soubory v `src/`
2. Spusťte `npm run build` (nebo nechte běžet `npm run watch`)
3. Načtěte doplněk znovu v Debug režimu z `dist/manifest.json`
4. Otevřete konzoli pro ladění: Tools → Developer Tools → Browser Console

Automatické ověření bez skutečného Gmailu (falešné API, headless Chrome a headless Thunderbird s dočasným profilem) popisuje
[.claude/skills/run-gmail-archive-deduplicator/SKILL.md](.claude/skills/run-gmail-archive-deduplicator/SKILL.md).

## Podpora

Chyby a návrhy na vylepšení hlaste přes [GitHub Issues](https://github.com/petrf22/gmail-archive-deduplicator/issues).

## Licence

MIT, viz soubor [LICENSE](LICENSE).

## Autor

Petr Franta

## Změny

### Verze 1.8.0
- Zprávy bez Message-ID se znovu párují podle předmětu, data a odesílatele (Thunderbird jim generuje ID `md5:…`, které se dříve bralo jako skutečné)
- Po zastavení hledání zůstane zobrazená výsledná hláška, nepřepíše ji pozdější zpráva o průběhu
- Seznam duplicit vyplní zbytek okna, okno z menu Nástroje je vyšší (650×750)
- Automatická detekce Gmail „All Mail“ zná i název „[Gmail]/Všechna pošta“

Starší změny najdete v historii gitu.