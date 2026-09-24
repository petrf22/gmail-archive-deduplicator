# Návod k instalaci - Gmail Archive Deduplicator

## Příprava ikon

Před vytvořením .xpi balíčku potřebujete vytvořit ikony. Můžete použít jakýkoliv grafický editor nebo online nástroj.

### Požadované ikony:
- `icons/icon-16.png` - 16x16 pixelů
- `icons/icon-32.png` - 32x32 pixelů
- `icons/icon-48.png` - 48x48 pixelů

### Jednoduchý způsob vytvoření ikon:

1. Navštivte https://www.favicon-generator.org/
2. Nahrajte obrázek nebo vytvořte jednoduchý
3. Stáhněte vygenerované ikony
4. Přejmenujte je podle potřeby
5. Umístěte je do složky `icons/`

## Instalace do Thunderbirdu

### Krok 1: Vytvoření .xpi balíčku

Vyžaduje Node.js 18+ (Windows, Linux i Mac):
```bash
cd cesta/k/gmail-archive-deduplicator
npm install
npm run package
```
Balíček `gmail-archive-deduplicator.xpi` vznikne v kořeni projektu.

### Krok 2: Instalace v Thunderbirdu

1. Otevřete Thunderbird
2. Stiskněte `Ctrl+Shift+A` (nebo otevřete Menu → Doplňky a motivy)
3. Klikněte na ikonu ozubeného kola vpravo nahoře
4. Vyberte "Nainstalovat doplněk ze souboru..."
5. Vyberte soubor `gmail-archive-deduplicator.xpi`
6. Klikněte na "Přidat" v dialogu
7. Restartujte Thunderbird (doporučeno)

### Krok 3: První spuštění

1. Po restartu najděte ikonu doplňku v panelu nástrojů
   - Měla by se objevit automaticky
   - Pokud ne, klikněte pravým tlačítkem na panel nástrojů → Přizpůsobit
2. Klikněte na ikonu doplňku
3. Otevře se popup okno s rozhraním

## Testování bez instalace (vývojářský režim)

Pro rychlé testování bez vytváření .xpi (nejdřív `npm install` a `npm run build`):

1. Otevřete Thunderbird
2. Stiskněte `Ctrl+Shift+A`
3. Klikněte na ikonu ozubeného kola
4. Vyberte "Ladit doplňky"
5. Klikněte "Načíst dočasný doplněk"
6. Vyberte soubor `dist/manifest.json`
7. Doplněk se načte dočasně (zmizí po restartu)

## Ověření instalace

Po instalaci ověřte:

1. ✅ Ikona doplňku je viditelná v panelu nástrojů
2. ✅ Kliknutím na ikonu se otevře popup okno
3. ✅ V popup okně je vidět tlačítko "Vyhledat duplicity"
4. ✅ V seznamu doplňků (Ctrl+Shift+A) je vidět "Gmail Archive Deduplicator"

## Řešení problémů při instalaci

### Doplněk se nezobrazuje v panelu nástrojů
- Klikněte pravým tlačítkem na panel nástrojů → Přizpůsobit
- Najděte ikonu doplňku a přetáhněte ji do panelu

### Chyba při instalaci "Doplněk je poškozen"
- Zkontrolujte, že všechny soubory jsou ve správné struktuře
- Ujistěte se, že manifest.json je validní JSON
- Znovu vytvořte .xpi balíček

### Doplněk nelze nainstalovat
- Zkontrolujte verzi Thunderbirdu (minimálně 102)
- Zkuste restartovat Thunderbird
- Zkuste vývojářský režim (Debug Add-ons)

## Konfigurace Gmail účtu

Pro správné fungování doplňku:

1. **Povolte IMAP v Gmailu:**
   - Otevřete Gmail v prohlížeči
   - Nastavení → Viz všechna nastavení
   - Přeposílání a POP/IMAP
   - Povolte IMAP
   - Uložte změny

2. **Přidejte účet do Thunderbirdu:**
   - Menu → Účet → Přidat poštovní účet
   - Zadejte Gmail adresu a heslo
   - Thunderbird automaticky detekuje IMAP nastavení
   - Dokončete průvodce

3. **Ověřte přístup ke složkám:**
   - V Thunderbirdu najděte váš Gmail účet
   - Rozbalte strukturu složek
   - Ověřte, že vidíte složku "[Gmail]" a podsložku "All Mail"

## Tipy

- **Záloha před prvním použitím**: Vytvořte zálohu emailů
- **Testujte na malém vzorku**: První spuštění proveďte s malým počtem emailů
- **Sledujte konzoli**: Pro ladění otevřete Tools → Developer Tools → Browser Console
- **Pravidelné aktualizace**: Kontrolujte dostupnost nových verzí

## Další kroky

Po úspěšné instalaci:
1. Přečtěte si README.md pro detailní informace o použití
2. Spusťte první analýzu na testovacích datech
3. Zkontrolujte výsledky před hromadným smazáním
