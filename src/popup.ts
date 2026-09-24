// popup.ts - Logika pro popup okno

import type {
  BackgroundRequest,
  Duplicate,
  FolderRef,
  MailFolder,
  ProgressMessage,
  ResponseFor,
} from './types';

type StatusType = 'loading' | 'error' | 'success' | 'info';

interface FolderInfo {
  id: string | undefined;
  accountId: string;
  path: string;
  name: string | undefined;
  accountName: string;
  accountType: string;
}

let duplicatesData: Duplicate[] = [];

// Běží hledání nebo přesun? Progress zprávy, které dorazí až po skončení operace
// (např. od druhého paralelního načítání po Stop), by jinak přepsaly výsledný stav
let operationRunning = false;

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element #${id} nebyl nalezen v popup.html`);
  }
  return element as T;
}

const scanBtn = getElement<HTMLButtonElement>('scanBtn');
const stopBtn = getElement<HTMLButtonElement>('stopBtn');
const moveBtn = getElement<HTMLButtonElement>('moveBtn');
const statusDiv = getElement<HTMLDivElement>('status');
const duplicatesList = getElement<HTMLDivElement>('duplicatesList');
const counterDiv = getElement<HTMLDivElement>('counter');
const selectAllCheckbox = getElement<HTMLInputElement>('selectAll');
const selectAllContainer = getElement<HTMLDivElement>('selectAllContainer');

// Dropdown elementy
const archiveFolderSelect = getElement<HTMLSelectElement>('archiveFolder');
const gmailAllMailSelect = getElement<HTMLSelectElement>('gmailAllMail');
const gmailTrashSelect = getElement<HTMLSelectElement>('gmailTrash');

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Pošle požadavek do background.ts a vrátí typovanou odpověď
 */
function send<R extends BackgroundRequest>(request: R): Promise<ResponseFor[R['action']]> {
  return messenger.runtime.sendMessage(request);
}

// Naslouchání progress zprávám z background.ts
messenger.runtime.onMessage.addListener((message: ProgressMessage | BackgroundRequest) => {
  if (message.action === 'progress' && operationRunning) {
    updateStatus(message.message, 'loading');
  }
});

/**
 * Načte všechny složky ze všech účtů
 */
async function loadFolders(): Promise<void> {
  try {
    const accounts = await messenger.accounts.list(true);

    const localFolders: FolderInfo[] = [];
    const gmailFolders: FolderInfo[] = [];

    // Projdeme všechny účty a jejich složky
    for (const account of accounts) {
      collectFolders(account.folders, account, localFolders, gmailFolders);
    }

    // Naplníme dropdowny
    populateFolderSelect(archiveFolderSelect, localFolders, 'Vyberte archivní složku');
    populateFolderSelect(gmailAllMailSelect, gmailFolders, 'Vyberte Gmail All Mail');
    populateFolderSelect(gmailTrashSelect, gmailFolders, 'Vyberte Gmail Koš');

    updateStatus('Vyberte složky a klikněte na "Vyhledat duplicity"', 'info');

  } catch (error) {
    updateStatus(`Chyba při načítání složek: ${errorMessage(error)}`, 'error');
  }
}

/**
 * Rekurzivně projde složky a seřadí je podle typu účtu
 */
function collectFolders(
  folders: MailFolder[] | undefined,
  account: messenger.accounts.MailAccount,
  localFolders: FolderInfo[],
  gmailFolders: FolderInfo[],
  path = ''
): void {
  if (!folders) return;

  for (const folder of folders) {
    const folderPath = path ? `${path}/${folder.name}` : (folder.name ?? '');
    const folderInfo: FolderInfo = {
      id: folder.id,
      accountId: account.id,
      path: folder.path || folderPath,
      name: folder.name,
      accountName: account.name,
      accountType: account.type
    };

    // Rozděl podle typu účtu
    if (account.type === 'none') {
      localFolders.push(folderInfo);
    } else if (account.type === 'imap') {
      gmailFolders.push(folderInfo);
    }

    // Rekurzivně projdi podsložky
    if (folder.subFolders && folder.subFolders.length > 0) {
      collectFolders(folder.subFolders, account, localFolders, gmailFolders, folderPath);
    }
  }
}

function folderKey(folderInfo: FolderInfo): string {
  return `${folderInfo.accountId}|${folderInfo.path}`;
}

/**
 * Naplní dropdown seznam složek
 */
function populateFolderSelect(selectElement: HTMLSelectElement, folders: FolderInfo[], placeholder: string): void {
  selectElement.innerHTML = '';

  // Placeholder
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  selectElement.appendChild(placeholderOption);

  // Přidej složky
  folders.forEach(folderInfo => {
    const option = document.createElement('option');
    option.value = folderKey(folderInfo);
    option.textContent = `${folderInfo.accountName} → ${folderInfo.path}`;
    option.dataset.folderData = JSON.stringify(folderInfo);
    selectElement.appendChild(option);
  });

  // Auto-select pokud je možnost jednoznačná
  if (folders.length === 1) {
    selectElement.selectedIndex = 1;
  } else {
    // Pokus o smart auto-select
    autoSelectFolder(selectElement, folders);
  }
}

/**
 * Inteligentní auto-select složek podle jména
 */
function autoSelectFolder(selectElement: HTMLSelectElement, folders: FolderInfo[]): void {
  let bestMatch: FolderInfo | undefined;

  if (selectElement === archiveFolderSelect) {
    // Hledej "Archive", "Archiv", "Archives"
    bestMatch = folders.find(f =>
      /^(Archive|Archiv|Archives)$/i.test(f.name ?? '')
    );
  } else if (selectElement === gmailAllMailSelect) {
    // Hledej "All Mail", "Všechny zprávy"
    bestMatch = folders.find(f =>
      /All Mail|Všechny zprávy|Všechna pošta/i.test(f.path)
    );
  } else if (selectElement === gmailTrashSelect) {
    // Hledej "Trash", "Koš"
    bestMatch = folders.find(f =>
      /Trash|Koš/i.test(f.path)
    );
  }

  if (bestMatch) {
    const key = folderKey(bestMatch);
    const index = Array.from(selectElement.options).findIndex(opt => opt.value === key);
    if (index !== -1) {
      selectElement.selectedIndex = index;
    }
  }
}

/**
 * Vrátí vybranou složku jako {accountId, path} - samotná cesta není napříč účty unikátní
 */
function getSelectedFolderRef(selectElement: HTMLSelectElement): FolderRef {
  const folderInfo: FolderInfo = JSON.parse(selectElement.options[selectElement.selectedIndex].dataset.folderData!);
  return { accountId: folderInfo.accountId, path: folderInfo.path };
}

/**
 * Aktualizuje status zprávu
 */
function updateStatus(message: string, type: StatusType = 'loading'): void {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
}

/**
 * Formátuje datum
 */
function formatDate(date: Duplicate['date'] | undefined): string {
  if (!date) return 'Neznámé datum';
  return new Date(date).toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Zobrazí seznam duplicit
 */
function displayDuplicates(duplicates: Duplicate[]): void {
  duplicatesList.innerHTML = '';

  if (duplicates.length === 0) {
    updateStatus('Žádné duplicity nebyly nalezeny', 'success');
    duplicatesList.style.display = 'none';
    selectAllContainer.style.display = 'none';
    counterDiv.style.display = 'none';
    return;
  }

  duplicates.forEach((dup, index) => {
    const item = document.createElement('div');
    item.className = 'duplicate-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'duplicate-checkbox';
    checkbox.id = `dup-${index}`;
    checkbox.checked = true;
    checkbox.dataset.gmailId = String(dup.gmailMessage.id);
    checkbox.addEventListener('change', updateCounter);

    const info = document.createElement('div');
    info.className = 'duplicate-info';

    const subject = document.createElement('div');
    subject.className = 'duplicate-subject';
    subject.textContent = dup.subject || '(Bez předmětu)';

    const details = document.createElement('div');
    details.className = 'duplicate-details';
    details.textContent = `Od: ${dup.author || 'Neznámý'} | ${formatDate(dup.date)}`;

    info.appendChild(subject);
    info.appendChild(details);

    item.appendChild(checkbox);
    item.appendChild(info);

    duplicatesList.appendChild(item);
  });

  duplicatesList.style.display = 'block';
  selectAllContainer.style.display = 'block';
  moveBtn.style.display = 'inline-block';
  updateCounter();
  updateStatus(`Nalezeno ${duplicates.length} duplicitních emailů`, 'success');
  adjustLayoutForWindowSize();
}

/**
 * Aktualizuje počítadlo vybraných emailů
 */
function updateCounter(): void {
  const checkboxes = document.querySelectorAll('.duplicate-checkbox');
  const checked = document.querySelectorAll('.duplicate-checkbox:checked');

  counterDiv.textContent = `Vybráno: ${checked.length} z ${checkboxes.length}`;
  counterDiv.style.display = 'block';

  moveBtn.disabled = checked.length === 0;
}

/**
 * Vyhledá duplicity
 */
async function scanForDuplicates(): Promise<void> {
  try {
    // Validace výběru složek
    if (!archiveFolderSelect.value) {
      updateStatus('Vyberte lokální archivní složku', 'error');
      return;
    }
    if (!gmailAllMailSelect.value) {
      updateStatus('Vyberte Gmail složku "Všechny zprávy"', 'error');
      return;
    }
    if (!gmailTrashSelect.value) {
      updateStatus('Vyberte Gmail složku "Koš"', 'error');
      return;
    }

    const folderRefs = {
      archiveFolder: getSelectedFolderRef(archiveFolderSelect),
      gmailAllMail: getSelectedFolderRef(gmailAllMailSelect)
    };

    scanBtn.disabled = true;
    stopBtn.disabled = false;  // Reset pro novou analýzu
    stopBtn.style.display = 'inline-block';
    moveBtn.style.display = 'none';
    duplicatesList.style.display = 'none';
    selectAllContainer.style.display = 'none';
    counterDiv.style.display = 'none';
    updateStatus('Spouštím analýzu...', 'loading');
    operationRunning = true;

    const response = await send({ action: 'findDuplicates', folderRefs });

    if (response.success) {
      duplicatesData = response.data.duplicates;
      displayDuplicates(duplicatesData);
    } else {
      updateStatus(`Chyba: ${response.error}`, 'error');
    }
  } catch (error) {
    updateStatus(`Chyba: ${errorMessage(error)}`, 'error');
  } finally {
    operationRunning = false;
    scanBtn.disabled = false;
    stopBtn.style.display = 'none';
  }
}

/**
 * Přesune vybrané duplicity do koše
 */
async function moveDuplicates(): Promise<void> {
  const checkboxes = document.querySelectorAll<HTMLInputElement>('.duplicate-checkbox:checked');
  const gmailIds = Array.from(checkboxes).map(cb => parseInt(cb.dataset.gmailId!));

  if (gmailIds.length === 0) {
    updateStatus('Není vybrán žádný email', 'error');
    return;
  }

  const confirmed = confirm(
    `Opravdu chcete přesunout ${gmailIds.length} emailů do koše Gmail?\n\n` +
    'Tato akce odstraní duplicitní emaily z Gmail účtu (ze složky All Mail).'
  );

  if (!confirmed) {
    return;
  }

  try {
    moveBtn.disabled = true;
    moveBtn.style.display = 'none';  // Skryjeme Move tlačítko
    scanBtn.disabled = true;
    stopBtn.disabled = false;  // Reset pro nový přesun
    stopBtn.style.display = 'inline-block';  // Zobrazíme Stop
    updateStatus(`Přesouvám ${gmailIds.length} emailů...`, 'loading');
    operationRunning = true;

    const response = await send({
      action: 'moveDuplicates',
      duplicateIds: gmailIds,
      gmailTrash: getSelectedFolderRef(gmailTrashSelect)
    });

    if (response.success) {
      const movedIds = new Set(response.movedIds);
      const failedCount = response.stopped ? 0 : gmailIds.length - movedIds.size;

      // Odstraníme ze seznamu jen skutečně přesunuté položky
      checkboxes.forEach(cb => {
        if (movedIds.has(parseInt(cb.dataset.gmailId!))) {
          cb.closest('.duplicate-item')?.remove();
        }
      });
      duplicatesData = duplicatesData.filter(dup => !movedIds.has(dup.gmailMessage.id));

      if (response.stopped) {
        updateStatus(`Přesun zastaven. Přesunuto ${movedIds.size} z ${gmailIds.length} emailů`, 'info');
      } else if (failedCount > 0) {
        updateStatus(`Přesunuto ${movedIds.size} z ${gmailIds.length} emailů, ${failedCount} se nepodařilo přesunout`, 'error');
      } else {
        updateStatus(`Přesunuto ${movedIds.size} emailů do koše`, 'success');
      }
    } else {
      updateStatus(`Chyba: ${response.error}`, 'error');
    }
  } catch (error) {
    updateStatus(`Chyba: ${errorMessage(error)}`, 'error');
  } finally {
    operationRunning = false;
    stopBtn.style.display = 'none';
    scanBtn.disabled = false;
    moveBtn.disabled = false;

    if (duplicatesData.length === 0) {
      duplicatesList.style.display = 'none';
      selectAllContainer.style.display = 'none';
      counterDiv.style.display = 'none';
    } else {
      moveBtn.style.display = 'inline-block';
      updateCounter();
    }
  }
}

/**
 * Vybere/odznačí všechny checkboxy
 */
function toggleSelectAll(): void {
  document.querySelectorAll<HTMLInputElement>('.duplicate-checkbox').forEach(cb => {
    cb.checked = selectAllCheckbox.checked;
  });
  updateCounter();
}

/**
 * Zastaví probíhající operaci
 */
async function stopOperation(): Promise<void> {
  stopBtn.disabled = true;
  updateStatus('Zastavuji operaci...', 'loading');

  try {
    await send({ action: 'stop' });
  } catch (error) {
    console.error('Chyba při zastavování:', error);
  }
}

/**
 * Upraví výšku seznamu duplicit podle velikosti okna
 */
function adjustLayoutForWindowSize(): void {
  if (duplicatesList.style.display === 'none') {
    return;  // Skrytý seznam nemá pozici, spočítá se po zobrazení
  }
  // Seznam vyplní zbytek okna pod sebou (15px = spodní padding body)
  const availableHeight = window.innerHeight - duplicatesList.getBoundingClientRect().top - 15;
  // Minimum 150px, v příliš malém okně se pak posouvá celá stránka
  duplicatesList.style.maxHeight = `${Math.max(availableHeight, 150)}px`;
}

/**
 * Aktualizuje titulek s verzí z manifestu
 */
function updateTitleWithVersion(): void {
  const titleElement = document.querySelector('h1');
  if (titleElement) {
    titleElement.textContent = `🗂️ Gmail Archive Deduplicator (v${messenger.runtime.getManifest().version})`;
  }
}

// Event listenery
scanBtn.addEventListener('click', scanForDuplicates);
stopBtn.addEventListener('click', stopOperation);
moveBtn.addEventListener('click', moveDuplicates);
selectAllCheckbox.addEventListener('change', toggleSelectAll);

// Zastavit operaci při zavření okna
window.addEventListener('beforeunload', () => {
  if (stopBtn.style.display !== 'none') {
    // Operace běží, zastavíme ji
    send({ action: 'stop' }).catch(error => console.error('Chyba při zastavování:', error));
  }
});

// Upravit layout při změně velikosti okna
window.addEventListener('resize', adjustLayoutForWindowSize);

// Načti složky při otevření popup
loadFolders();

// Nastav správnou velikost při prvním načtení
adjustLayoutForWindowSize();

// Aktualizuj titulek s verzí
updateTitleWithVersion();
