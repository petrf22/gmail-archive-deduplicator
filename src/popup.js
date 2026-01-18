// popup.js - Logika pro popup okno

let duplicatesData = [];

const scanBtn = document.getElementById('scanBtn');
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
      path: folder.path || folderPath,
      name: folder.name,
      accountName: account.name,
      accountType: account.type,
      folder: folder
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
    option.value = folderInfo.path;
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
    const index = options.findIndex(opt => opt.value === bestMatch.path);
    if (index !== -1) {
      selectElement.selectedIndex = index;
    }
  }
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
    const archiveFolderData = JSON.parse(archiveFolderSelect.options[archiveFolderSelect.selectedIndex].dataset.folderData);
    const gmailAllMailData = JSON.parse(gmailAllMailSelect.options[gmailAllMailSelect.selectedIndex].dataset.folderData);
    const gmailTrashData = JSON.parse(gmailTrashSelect.options[gmailTrashSelect.selectedIndex].dataset.folderData);

    scanBtn.disabled = true;
    moveBtn.style.display = 'none';
    duplicatesList.style.display = 'none';
    selectAllContainer.style.display = 'none';
    counterDiv.style.display = 'none';
    updateStatus('Spouštím analýzu...', 'loading');

    const response = await messenger.runtime.sendMessage({
      action: 'findDuplicates',
      folderPaths: {
        archiveFolder: archiveFolderData.path,
        gmailAllMail: gmailAllMailData.path,
        gmailTrash: gmailTrashData.path
      }
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
    scanBtn.disabled = true;
    updateStatus(`Přesouvám ${gmailIds.length} emailů...`, 'loading');

    const response = await messenger.runtime.sendMessage({
      action: 'moveDuplicates',
      duplicateIds: gmailIds
    });

    if (response.success) {
      updateStatus('Emaily byly úspěšně přesunuty do koše', 'success');

      // Odstraníme přesunuté položky ze seznamu
      checkboxes.forEach(cb => {
        cb.closest('.duplicate-item').remove();
      });

      // Aktualizujeme data
      duplicatesData = duplicatesData.filter(dup =>
        !gmailIds.includes(dup.gmailMessage.id)
      );

      updateCounter();

      if (duplicatesData.length === 0) {
        duplicatesList.style.display = 'none';
        selectAllContainer.style.display = 'none';
        moveBtn.style.display = 'none';
        counterDiv.style.display = 'none';
      }
    } else {
      updateStatus(`Chyba: ${response.error}`, 'error');
    }
  } catch (error) {
    updateStatus(`Chyba: ${error.message}`, 'error');
  } finally {
    moveBtn.disabled = false;
    scanBtn.disabled = false;
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

// Event listenery
scanBtn.addEventListener('click', scanForDuplicates);
moveBtn.addEventListener('click', moveDuplicates);
selectAllCheckbox.addEventListener('change', toggleSelectAll);

// Načti složky při otevření popup
loadFolders();
