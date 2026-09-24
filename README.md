# Gmail Archive Deduplicator - Doplněk pro Thunderbird

Tento doplněk automaticky detekuje a odstraňuje duplicitní emaily mezi lokálním archivem a Gmail účtem.

## Funkce

- ✅ Automatická detekce lokální archivní složky
- ✅ Automatická detekce Gmail složky "All Mail"
- ✅ Porovnání emailů pomocí Message-ID a dalších atributů
- ✅ Přehledný seznam duplicit s možností výběru
- ✅ Bezpečný přesun do Gmail koše
- ✅ Česká lokalizace

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

1. Klikněte na ikonu doplňku v panelu nástrojů Thunderbirdu
2. Klikněte na tlačítko **"Vyhledat duplicity"**
3. Počkejte na dokončení analýzy (může trvat několik minut u velkých mailboxů)
4. Zkontrolujte seznam nalezených duplicit
5. Odškrtněte emaily, které nechcete smazat (volitelné)
6. Klikněte na **"Přesunout vybrané do koše"**
7. Potvrďte akci

## Jak to funguje

Doplněk provádí následující kroky:

1. **Detekce složek**: Automaticky najde lokální archivní složku a Gmail složku "All Mail"
2. **Načtení emailů**: Načte všechny emaily z obou složek
3. **Porovnání**: Pro každý email v lokálním archivu zkontroluje, zda existuje v Gmail
   - Primárně používá Message-ID (unikátní identifikátor emailu)
   - Sekundárně používá kombinaci předmětu, data a odesílatele
4. **Zobrazení duplicit**: Vypíše všechny nalezené duplicity
5. **Přesun**: Po potvrzení přesune vybrané emaily do Gmail koše

## Co doplněk NEDĚLÁ

- **Nemažé lokální archiv**: Duplicitní emaily zůstávají v lokálním archivu
- **Pouze Gmail**: Přesouvá duplicity pouze v Gmail účtu (do koše)
- **Nevyhledává automaticky**: Musíte spustit analýzu manuálně

## Poznámky

### Bezpečnost
- Doplněk pouze přesouvá emaily do koše, ne trvale nemazá
- Z Gmail koše můžete emaily obnovit do 30 dnů
- Doporučujeme před použitím vytvořit zálohu

### Výkon
- Analýza může trvat několik minut u velkých mailboxů
- Doporučujeme zavřít ostatní aplikace během analýzy
- První spuštění bude pomalejší kvůli indexování

### Detekce složek
Doplněk automaticky hledá tyto názvy složek:
- **Lokální archiv**: "Archives", "Archiv", "Archive"
- **Gmail All Mail**: "[Gmail]/All Mail", "All Mail", "[Gmail]/Všechna pošta"
- **Gmail Koš**: "[Gmail]/Trash", "Trash", "[Gmail]/Koš", "Koš"

## Řešení problémů

### Doplněk nenalezne složky
- Zkontrolujte, že máte nakonfigurovaný Gmail účet přes IMAP
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

Vyžaduje Node.js 18+.

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

## Podpora

Pro nahlášení chyb nebo návrhy na vylepšení:
- Email: [váš email]
- GitHub Issues: [odkaz na repozitář]

## Licence

[Vyberte licenci, např. MIT]

## Autor

[Vaše jméno]

## Změny

### Verze 1.0
- Základní funkcionalita
- Detekce duplicit mezi lokálním archivem a Gmail
- Přesun do Gmail koše
- České rozhraní