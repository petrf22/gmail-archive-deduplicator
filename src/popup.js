// popup.js - Logika pro popup okno

let duplicatesData = [];

const scanBtn = document.getElementById('scanBtn');
const stopBtn = document.getElementById('stopBtn');
const moveBtn = document.getElementById('moveBtn');
const statusDiv = document.getElementById('status');
const duplicatesList = document.getElementById('duplicatesList');
const counterDiv = document.getElementById('counter');
const selectAllCheckbox = document.getElementById('selectAll');
const selectAllContainer = document.getElementById('selectAllContainer');

// Dropdown elementy
const archiveFolderSelect = document.getElementById('archiveFolder');
const gmailAllMailSelect = document.getElementById('gmailAllMail');
const gmailTrashSelect = document.getElementById('gmailTrash');

// Naslouchání progress zprávám z background.js
messenger.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'progress') {
    updateStatus(message.message, 'loading');
  }
});

/**
 * Načte všechny složky ze všech účtů
 */
async function loadFolders() {
  try {
    const accounts = await messenger.accounts.list();
    
    const localFolders = [];
    const gmailFolders = [];
    
    // Projdeme všechny účty a jejich složky
    for (const account of accounts) {
      await collectFolders(account.folders, account, localFolders, gmailFolders);
    }
    
    // Naplníme dropdowny
    populateFolderSelect(archiveFolderSelect, localFolders, 'Vyberte archivní složku');
    populateFolderSelect(gmailAllMailSelect, gmailFolders, 'Vyberte Gmail All Mail');
    populateFolderSelect(gmailTrashSelect, gmailFolders, 'Vyberte Gmail Koš');
    
    updateStatus('Vyberte složky a klikněte na "Vyhledat duplicity"', 'info');
    
  } catch (error) {
    updateStatus(`Chyba při načítání složek: ${error.message}`, 'error');
  }
}

/**
 * Rekurzivně projde složky a seřadí je podle typu účtu
 */
async function collectFolders(folders, account, localFolders, gmailFolders, path = '') {
  if (!folders) return;
  
  for (const folder of folders) {
    const folderPath = path ? `${path}/${folder.name}` : folder.name;
    const folderInfo = {
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
      await collectFolders(folder.subFolders, account, localFolders, gmailFolders, folderPath);
    }
  }
}

/**
 * Naplní dropdown seznam složek
 */
function populateFolderSelect(selectElement, folders, placeholder) {
  selectElement.innerHTML = '';
  
  // Placeholder
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  selectElement.appendChild(placeholderOption);
  
  // Přidej složky
  folders.forEach(folderInfo => {
    const option = document.createElement('option');
    option.value = `${folderInfo.accountId}|${folderInfo.path}`;
    option.textContent = `${folderInfo.accountName} → ${folderInfo.path}`;
    option.dataset.folderId = folderInfo.id;
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
function autoSelectFolder(selectElement, folders) {
  let bestMatch = null;
  
  if (selectElement === archiveFolderSelect) {
    // Hledej "Archive", "Archiv", "Archives"
    bestMatch = folders.find(f => 
      /^(Archive|Archiv|Archives)$/i.test(f.name)
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
    // Najdi index v selectu
    const options = Array.from(selectElement.options);
    const index = options.findIndex(opt => opt.value === `${bestMatch.accountId}|${bestMatch.path}`);
    if (index !== -1) {
      selectElement.selectedIndex = index;
    }
  }
}

/**
 * Vrátí vybranou složku jako {accountId, path} - samotná cesta není napříč účty unikátní
 */
function getSelectedFolderRef(selectElement) {
  const folderInfo = JSON.parse(selectElement.options[selectElement.selectedIndex].dataset.folderData);
  return { accountId: folderInfo.accountId, path: folderInfo.path };
}

/**
 * Aktualizuje status zprávu
 */
function updateStatus(message, type = 'loading') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
}

/**
 * Formátuje datum
 */
function formatDate(dateString) {
  if (!dateString) return 'Neznámé datum';
  const date = new Date(dateString);
  return date.toLocaleString('cs-CZ', {
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
function displayDuplicates(duplicates) {
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
    checkbox.dataset.gmailId = dup.gmailMessage.id;
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
}

/**
 * Aktualizuje počítadlo vybraných emailů
 */
function updateCounter() {
  const checkboxes = document.querySelectorAll('.duplicate-checkbox');
  const checked = document.querySelectorAll('.duplicate-checkbox:checked');
  
  counterDiv.textContent = `Vybráno: ${checked.length} z ${checkboxes.length}`;
  counterDiv.style.display = 'block';
  
  moveBtn.disabled = checked.length === 0;
}

/**
 * Vyhledá duplicity
 */
async function scanForDuplicates() {
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
    
    // Získej data o složkách
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
    
    const response = await messenger.runtime.sendMessage({
      action: 'findDuplicates',
      folderRefs
    });
    
    if (response.success) {
      duplicatesData = response.data.duplicates;
      displayDuplicates(duplicatesData);
    } else {
      updateStatus(`Chyba: ${response.error}`, 'error');
    }
  } catch (error) {
    updateStatus(`Chyba: ${error.message}`, 'error');
  } finally {
    scanBtn.disabled = false;
    stopBtn.style.display = 'none';
  }
}

/**
 * Přesune vybrané duplicity do koše
 */
async function moveDuplicates() {
  const checkboxes = document.querySelectorAll('.duplicate-checkbox:checked');
  const gmailIds = Array.from(checkboxes).map(cb => parseInt(cb.dataset.gmailId));
  
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
    
    const response = await messenger.runtime.sendMessage({
      action: 'moveDuplicates',
      duplicateIds: gmailIds,
      gmailTrash: getSelectedFolderRef(gmailTrashSelect)
    });
    
    if (response.success) {
      const movedIds = new Set(response.movedIds);
      const failedCount = response.stopped ? 0 : gmailIds.length - movedIds.size;
      
      // Odstraníme ze seznamu jen skutečně přesunuté položky
      checkboxes.forEach(cb => {
        if (movedIds.has(parseInt(cb.dataset.gmailId))) {
          cb.closest('.duplicate-item').remove();
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
    updateStatus(`Chyba: ${error.message}`, 'error');
  } finally {
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
function toggleSelectAll() {
  const checkboxes = document.querySelectorAll('.duplicate-checkbox');
  checkboxes.forEach(cb => {
    cb.checked = selectAllCheckbox.checked;
  });
  updateCounter();
}

/**
 * Zastaví probíhající operaci
 */
async function stopOperation() {
  stopBtn.disabled = true;
  updateStatus('Zastavuji operaci...', 'loading');
  
  try {
    await messenger.runtime.sendMessage({ action: 'stop' });
  } catch (error) {
    console.error('Chyba při zastavování:', error);
  }
}


/**
 * Upraví výšku seznamu duplicit podle velikosti okna
 */
function adjustLayoutForWindowSize() {
  const windowHeight = window.innerHeight;
  const duplicatesList = document.getElementById('duplicatesList');
  
  // Vypočítáme dostupnou výšku pro seznam
  // Odečteme místo pro header, folder selection, status, buttons
  const availableHeight = windowHeight - 350; // 350px pro ostatní elementy
  
  if (availableHeight > 200) {
    duplicatesList.style.maxHeight = `${availableHeight}px`;
  } else {
    duplicatesList.style.maxHeight = '200px'; // Minimum
  }
}


/**
 * Aktualizuje titulek s verzí z manifestu
 */
async function updateTitleWithVersion() {
  try {
    const manifest = await messenger.runtime.getManifest();
    const version = manifest.version;
    const titleElement = document.querySelector('h1');
    if (titleElement) {
      titleElement.textContent = `🗂️ Gmail Archive Deduplicator (v${version})`;
    }
  } catch (error) {
    console.error('Chyba při načítání verze:', error);
  }
}

// Event listenery
scanBtn.addEventListener('click', scanForDuplicates);
stopBtn.addEventListener('click', stopOperation);
moveBtn.addEventListener('click', moveDuplicates);
selectAllCheckbox.addEventListener('change', toggleSelectAll);

// Zastavit operaci při zavření okna
window.addEventListener('beforeunload', async () => {
  if (stopBtn.style.display !== 'none') {
    // Operace běží, zastavíme ji
    try {
      await messenger.runtime.sendMessage({ action: 'stop' });
      console.log('Operace zastavena kvůli zavření okna');
    } catch (error) {
      console.error('Chyba při zastavování:', error);
    }
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
