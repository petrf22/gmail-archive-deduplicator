// popup.js - Logika pro popup okno

let duplicatesData = [];

const scanBtn = document.getElementById('scanBtn');
const moveBtn = document.getElementById('moveBtn');
const statusDiv = document.getElementById('status');
const duplicatesList = document.getElementById('duplicatesList');
const counterDiv = document.getElementById('counter');
const selectAllCheckbox = document.getElementById('selectAll');
const selectAllContainer = document.getElementById('selectAllContainer');

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
    scanBtn.disabled = true;
    moveBtn.style.display = 'none';
    duplicatesList.style.display = 'none';
    selectAllContainer.style.display = 'none';
    counterDiv.style.display = 'none';
    updateStatus('Spouštím analýzu...', 'loading');

    const response = await messenger.runtime.sendMessage({
      action: 'findDuplicates'
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