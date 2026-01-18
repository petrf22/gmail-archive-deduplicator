# Pokročilé použití

## Přizpůsobení detekce složek

Pokud doplněk nenalezne vaše složky automaticky, můžete upravit seznam hledaných názvů v `background.js`:

```javascript
// Pro lokální archiv (řádek ~35)
const folders = await findFolderByName(account.folders, [
  'Archives', 
  'Archiv', 
  'Archive',
  'VÁŠ_VLASTNÍ_NÁZEV'  // Přidejte vlastní název
]);

// Pro Gmail All Mail (řádek ~53)
const folders = await findFolderByName(account.folders, [
  '[Gmail]/All Mail', 
  'All Mail', 
  '[Gmail]/Všechna pošta',
  'VÁŠ_GMAIL_NÁZEV'  // Přidejte vlastní název
]);
```

## Ladění a debugging

### Zobrazení konzole
1. Tools → Developer Tools → Browser Console
2. Všechny chyby a logy se zobrazí zde

### Přidání vlastních logů
V `background.js` přidejte:
```javascript
console.log('Moje zpráva:', proměnná);
```

### Kontrola, které složky byly nalezeny
Přidejte do funkce `findDuplicates`:
```javascript
console.log('Archiv:', archiveFolder);
console.log('Gmail All Mail:', gmailAllMail);
```

## Optimalizace výkonu

### Pro velké mailboxy (50 000+ emailů)

1. **Rozdělte analýzu na části:**
Upravte funkci `findDuplicates` pro zpracování po dávkách:

```javascript
const BATCH_SIZE = 1000; // Zpracovávat po 1000 emailech

for (let i = 0; i < archiveMessages.length; i += BATCH_SIZE) {
  const batch = archiveMessages.slice(i, i + BATCH_SIZE);
  // Zpracování dávky
  progressCallback(`Zpracovávám ${i}-${i+BATCH_SIZE} z ${archiveMessages.length}`);
}
```

2. **Použijte caching:**
Pokud pravidelně kontrolujete duplicity, můžete si ukládat již zkontrolované Message-ID.

## Rozšíření funkcionality

### Přidání dalších kritérií pro duplicity

V `background.js` upravte funkci `getMessageHash`:

```javascript
async function getMessageHash(message) {
  const subject = message.subject || '';
  const date = message.date ? new Date(message.date).getTime() : 0;
  const author = message.author || '';
  const size = message.size || 0;  // Přidání velikosti
  return `${subject}|${date}|${author}|${size}`;
}
```

### Export seznamu duplicit do CSV

Přidejte do `popup.js`:

```javascript
function exportToCSV(duplicates) {
  const csv = [
    ['Předmět', 'Odesílatel', 'Datum', 'Message-ID'],
    ...duplicates.map(d => [
      d.subject,
      d.author,
      d.date,
      d.messageId
    ])
  ].map(row => row.join(';')).join('\n');
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'duplicity.csv';
  a.click();
}
```

### Přidání filtru podle data

V popup okně přidejte možnost filtrovat duplicity:

```javascript
function filterByDate(duplicates, startDate, endDate) {
  return duplicates.filter(dup => {
    const date = new Date(dup.date);
    return date >= startDate && date <= endDate;
  });
}
```

## Statistiky a analýza

### Přidání statistik do UI

V `popup.html` přidejte sekci:

```html
<div id="stats" class="stats" style="display: none;">
  <h3>Statistiky</h3>
  <p>Celková velikost duplicit: <span id="totalSize"></span></p>
  <p>Nejstarší duplicita: <span id="oldestDup"></span></p>
  <p>Nejnovější duplicita: <span id="newestDup"></span></p>
</div>
```

V `popup.js` přidejte funkci:

```javascript
function showStats(duplicates) {
  const totalSize = duplicates.reduce((sum, d) => sum + (d.archiveMessage.size || 0), 0);
  const dates = duplicates.map(d => new Date(d.date)).sort();
  
  document.getElementById('totalSize').textContent = formatSize(totalSize);
  document.getElementById('oldestDup').textContent = formatDate(dates[0]);
  document.getElementById('newestDup').textContent = formatDate(dates[dates.length - 1]);
  document.getElementById('stats').style.display = 'block';
}

function formatSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}
```

## Automatizace

### Naplánované kontroly

Thunderbird bohužel nepodporuje cron-like scheduling v doplňcích. Můžete ale:

1. Vytvořit externí skript, který:
   - Spustí Thunderbird
   - Aktivuje doplněk přes CLI (pokud je dostupné)
   - Zavře Thunderbird

2. Použít systémový plánovač (cron/Task Scheduler):
```bash
# Linux/Mac cron - každý den v 2:00
0 2 * * * /path/to/your/script.sh
```

## Bezpečnostní doporučení

### Před prvním použitím
1. Vytvořte zálohu celého profilu Thunderbirdu
2. Exportujte důležité složky do MBOX formátu
3. Zkopírujte Gmail data přes Google Takeout

### Během používání
- Pravidelně kontrolujte Gmail koš
- Nemazejte emaily trvale hned
- Používejte "Vybrat všechny" opatrně

### Obnovení
Pokud omylem smažete důležité emaily:
1. Otevřete Gmail v prohlížeči
2. Přejděte do koše
3. Vyberte emaily k obnovení
4. Klikněte "Přesunout do"

## API Reference

### messenger.messages

**list(folder)** - Vrátí seznam zpráv ve složce
```javascript
const page = await messenger.messages.list(folder);
```

**getFull(messageId)** - Vrátí kompletní email včetně hlaviček
```javascript
const full = await messenger.messages.getFull(messageId);
```

**move(messageIds, destination)** - Přesune emaily
```javascript
await messenger.messages.move([id1, id2], trashFolder);
```

### messenger.accounts

**list()** - Vrátí seznam všech účtů
```javascript
const accounts = await messenger.accounts.list();
```

## Často kladené otázky (FAQ)

**Q: Proč se duplicity nemazou z lokálního archivu?**
A: Doplněk je navržen tak, aby byl konzervativní. Maže pouze z Gmail, kde máte 30 dní na obnovení.

**Q: Mohu přidat podporu pro více emailových služeb?**
A: Ano, upravte funkce `findGmailAllMailFolder` a `findGmailTrashFolder` pro detekci jiných služeb.

**Q: Doplněk je příliš pomalý, co dělat?**
A: Zkuste:
1. Redukovat počet emailů v archivu
2. Implementovat dávkové zpracování
3. Optimalizovat porovnávací algoritmus

**Q: Mohu přidat GUI pro výběr složek manuálně?**
A: Ano, můžete přidat dropdown menu s dostupnými složkami.

## Řešení specifických problémů

### Problem: Falešné duplicity
Pokud doplněk označuje emaily jako duplicity, i když nejsou:

1. Zkontrolujte Message-ID:
```javascript
console.log('Message-ID 1:', await getMessageId(msg1.id));
console.log('Message-ID 2:', await getMessageId(msg2.id));
```

2. Zpřísněte kritéria porovnání:
```javascript
// Přidejte kontrolu velikosti
if (Math.abs(msg1.size - msg2.size) > 100) {
  continue; // Není duplicita
}
```

### Problem: Chybějící duplicity
Pokud duplicity existují, ale nejsou nalezeny:

1. Zkontrolujte, zda oba emaily mají Message-ID
2. Povolte fallback na hash-based porovnání
3. Přidejte debug logy

## Další zdroje

- Thunderbird WebExtension API: https://webextension-api.thunderbird.net/
- MDN Web Extensions: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions
- Thunderbird Developer: https://developer.thunderbird.net/
