// background.js - Hlavní logika doplňku

// Vytvoření položky v menu Nástroje při startu
messenger.menus.create({
  id: "open-deduplicator",
  title: "Gmail Archive Deduplicator",
  contexts: ["tools_menu"]
});

// Pomocná funkce pro posílání progress zpráv do popup
function sendProgress(message) {
  // Posíláme zprávu všem otevřeným popup oknům
  messenger.runtime.sendMessage({
    action: 'progress',
    message: message
  }).catch(() => {
    // Ignorujeme chyby pokud popup není otevřený
  });
}

// Globální flag pro zastavení operace - OBJEKT pro sdílenou referenci mezi vlákny
const stopState = { requested: false };

const STOPPED_MESSAGE = 'Operace zastavena uživatelem';
const BATCH_SIZE = 50;

/**
 * Najde složku podle účtu a cesty ({accountId, path})
 * Samotná cesta není unikátní - např. "/Trash" existuje v lokálních složkách i v IMAP účtu
 */
async function findFolder(folderRef) {
  if (!folderRef || !folderRef.accountId || !folderRef.path) {
    return null;
  }

  const account = await messenger.accounts.get(folderRef.accountId, true);
  if (!account) {
    return null;
  }

  return searchFolderByPath(account.folders, folderRef.path);
}

/**
 * Rekurzivně hledá složku podle cesty
 */
function searchFolderByPath(folders, targetPath) {
  if (!folders) return null;

  for (const folder of folders) {
    if (folder.path === targetPath) {
      return folder;
    }

    if (folder.subFolders && folder.subFolders.length > 0) {
      const found = searchFolderByPath(folder.subFolders, targetPath);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Message-ID emailu - nejspolehlivější identifikátor pro porovnání duplicit
 * headerMessageId je součástí MessageHeader, není potřeba stahovat celou zprávu
 */
function getMessageId(message) {
  return message.headerMessageId || null;
}

/**
 * Získá hash emailu pro porovnání (pokud Message-ID chybí)
 * Bez předmětu, autora nebo data by hash nebyl dostatečně jedinečný
 */
function getMessageHash(message) {
  if (!message.subject || !message.author || !message.date) {
    return null;
  }
  const date = new Date(message.date).getTime();
  if (!date) {
    return null;
  }
  return `${message.subject}|${date}|${message.author}`;
}

/**
 * Načte všechny zprávy z jedné složky (se stránkováním)
 */
async function listFolderMessages(folder, onPage) {
  let page = await messenger.messages.list(folder);
  const messages = [...page.messages];
  onPage(messages.length);

  while (page.id) {
    if (stopState.requested) {
      throw new Error(STOPPED_MESSAGE);
    }

    page = await messenger.messages.continueList(page.id);
    messages.push(...page.messages);
    onPage(messages.length);
  }

  return messages;
}

/**
 * Načte zprávy ze složky a všech podsložek (procházení do šířky, bez rekurze)
 */
async function getAllMessagesFromFolderFast(folder, progressPrefix = '') {
  sendProgress(`${progressPrefix} - Rychlé načítání...`);

  const allMessages = [];
  const folderQueue = [{ folder, path: '' }];

  while (folderQueue.length > 0) {
    if (stopState.requested) {
      sendProgress(`Načítání archivu zastaveno po ${allMessages.length} emailech`);
      throw new Error(STOPPED_MESSAGE);
    }

    const current = folderQueue.shift();
    const indent = current.path ? '  ' : '';

    try {
      const folderMessages = await listFolderMessages(current.folder, () => {});

      if (folderMessages.length > 0) {
        allMessages.push(...folderMessages);
        sendProgress(`${progressPrefix} - ${indent}${current.folder.name}: ${folderMessages.length} emailů (celkem: ${allMessages.length})`);
      }
    } catch (error) {
      if (error.message === STOPPED_MESSAGE) {
        sendProgress(`Načítání archivu zastaveno po ${allMessages.length} emailech`);
        throw error;
      }
      console.log(`Nelze načíst zprávy ze složky ${current.folder.name}:`, error.message);
    }

    // Přidej podsložky do fronty (ne rekurze!)
    for (const subFolder of current.folder.subFolders || []) {
      folderQueue.push({
        folder: subFolder,
        path: current.path + '/' + subFolder.name
      });
    }
  }

  sendProgress(`${progressPrefix} - Celkem načteno ${allMessages.length} emailů`);
  return allMessages;
}

/**
 * Načte zprávy z Gmail All Mail (bez podsložek)
 */
async function loadGmailMessages(folder) {
  let loaded = 0;
  let lastReported = 0;
  try {
    return await listFolderMessages(folder, (count) => {
      loaded = count;
      // Progress každých 500 emailů
      if (count - lastReported >= 500) {
        lastReported = count;
        sendProgress(`Načítám Gmail: ${count} emailů...`);
      }
    });
  } catch (error) {
    if (error.message === STOPPED_MESSAGE) {
      sendProgress(`⏹ Načítání Gmail zastaveno po ${loaded} emailech`);
    }
    throw error;
  }
}

/**
 * Najde lokální archivní složku
 */
async function findLocalArchiveFolder() {
  const accounts = await messenger.accounts.list();

  for (const account of accounts) {
    // Hledáme lokální složky (typ "none")
    if (account.type === 'none') {
      const folders = findFolderByName(account.folders, ['Archives', 'Archiv', 'Archive']);
      if (folders.length > 0) {
        return folders[0];
      }
    }
  }

  return null;
}

/**
 * Najde Gmail složku "All Mail"
 */
async function findGmailAllMailFolder() {
  const accounts = await messenger.accounts.list();

  for (const account of accounts) {
    // Hledáme IMAP účty (Gmail)
    if (account.type === 'imap') {
      const folders = findFolderByName(account.folders, ['[Gmail]/All Mail', 'All Mail', '[Gmail]/Všechny zprávy']);
      if (folders.length > 0) {
        return folders[0];
      }
    }
  }

  return null;
}

/**
 * Najde Gmail koš v daném účtu (nebo v prvním IMAP účtu, který ho má)
 */
async function findGmailTrashFolder(accountId = null) {
  const accounts = await messenger.accounts.list();

  for (const account of accounts) {
    if (account.type === 'imap' && (!accountId || account.id === accountId)) {
      const folders = findFolderByName(account.folders, ['[Gmail]/Trash', 'Trash', '[Gmail]/Koš', 'Koš']);
      if (folders.length > 0) {
        return folders[0];
      }
    }
  }

  return null;
}

/**
 * Rekurzivně prohledá složky podle jména
 */
function findFolderByName(folders, names) {
  const results = [];

  for (const folder of folders || []) {
    if (names.some(name => folder.path.includes(name) || folder.name === name)) {
      results.push(folder);
    }

    if (folder.subFolders && folder.subFolders.length > 0) {
      results.push(...findFolderByName(folder.subFolders, names));
    }
  }

  return results;
}

/**
 * Indexuje Gmail zprávy podle Message-ID a podle hash (dvě oddělené mapy)
 */
function indexGmailMessages(gmailMessages) {
  const byMessageId = new Map();
  const byHash = new Map();
  let gmailErrors = 0;

  for (let i = 0; i < gmailMessages.length; i++) {
    if (i % 1000 === 0) {
      if (stopState.requested) {
        throw new Error(STOPPED_MESSAGE);
      }
      sendProgress(`Indexuji Gmail zprávy: ${i}/${gmailMessages.length}`);
    }

    const message = gmailMessages[i];
    const messageId = getMessageId(message);
    const hash = getMessageHash(message);

    if (!messageId && !hash) {
      gmailErrors++;
      continue;
    }

    if (messageId) {
      byMessageId.set(messageId, message);
    }
    if (hash) {
      byHash.set(hash, message);
    }
  }

  if (gmailErrors > 0) {
    sendProgress(`Varování: ${gmailErrors} Gmail emailů nemá Message-ID ani dostatečná metadata (přeskočeny)`);
  }

  return { byMessageId, byHash };
}

/**
 * Hledá duplicitní zprávy mezi archivem a Gmail
 * Hash (předmět|datum|autor) se použije jen pokud Message-ID chybí na jedné ze stran -
 * dvě zprávy s různým Message-ID nejsou duplicity, i když mají stejný předmět
 */
function findDuplicatesInArchive(archiveMessages, gmailIndex) {
  const duplicates = [];
  const processedGmailIds = new Set();
  let archiveErrors = 0;

  for (let i = 0; i < archiveMessages.length; i++) {
    if (i % 1000 === 0) {
      if (stopState.requested) {
        throw new Error(STOPPED_MESSAGE);
      }
      sendProgress(`Kontroluji archiv: ${i}/${archiveMessages.length}`);
    }

    const archiveMsg = archiveMessages[i];
    const messageId = getMessageId(archiveMsg);
    const hash = getMessageHash(archiveMsg);

    if (!messageId && !hash) {
      archiveErrors++;
      continue;
    }

    let gmailMsg = null;

    if (messageId) {
      gmailMsg = gmailIndex.byMessageId.get(messageId) || null;
    }

    if (!gmailMsg && hash) {
      const candidate = gmailIndex.byHash.get(hash);
      if (candidate && (!messageId || !getMessageId(candidate))) {
        gmailMsg = candidate;
      }
    }

    // Pokud nalezen a ještě nebyl použit
    if (gmailMsg && !processedGmailIds.has(gmailMsg.id)) {
      processedGmailIds.add(gmailMsg.id);

      duplicates.push({
        archiveMessage: archiveMsg,
        gmailMessage: gmailMsg,
        messageId: messageId,
        subject: archiveMsg.subject,
        date: archiveMsg.date,
        author: archiveMsg.author
      });
    }
  }

  if (archiveErrors > 0) {
    sendProgress(`Varování: ${archiveErrors} archivních emailů nemá Message-ID ani dostatečná metadata (přeskočeny)`);
  }

  return duplicates;
}

async function findDuplicates(folderRefs = null) {
  let archiveFolder, gmailAllMail;

  if (folderRefs) {
    // Použij složky vybrané uživatelem
    sendProgress('Načítám vybrané složky...');
    [archiveFolder, gmailAllMail] = await Promise.all([
      findFolder(folderRefs.archiveFolder),
      findFolder(folderRefs.gmailAllMail)
    ]);

    if (!archiveFolder) {
      throw new Error(`Archivní složka nenalezena: ${folderRefs.archiveFolder?.path}`);
    }
    if (!gmailAllMail) {
      throw new Error(`Gmail All Mail nenalezen: ${folderRefs.gmailAllMail?.path}`);
    }
  } else {
    // Automatická detekce (fallback)
    [archiveFolder, gmailAllMail] = await Promise.all([
      findLocalArchiveFolder(),
      findGmailAllMailFolder()
    ]);

    if (!archiveFolder) {
      throw new Error('Lokální archivní složka nebyla nalezena');
    }
    if (!gmailAllMail) {
      throw new Error('Gmail složka "All Mail" nebyla nalezena');
    }
  }

  sendProgress('Načítám emaily paralelně z archivu i Gmail...');

  // PARALELNÍ načtení archivu i Gmail najednou!
  const [archiveMessages, gmailMessages] = await Promise.all([
    getAllMessagesFromFolderFast(archiveFolder, 'Archiv'),
    loadGmailMessages(gmailAllMail)
  ]);

  sendProgress(`Načteno ${archiveMessages.length} emailů z archivu a ${gmailMessages.length} z Gmail. Hledám duplicity...`);

  const gmailIndex = indexGmailMessages(gmailMessages);
  const duplicates = findDuplicatesInArchive(archiveMessages, gmailIndex);

  sendProgress(`Analýza dokončena. Nalezeno ${duplicates.length} duplicit z ${archiveMessages.length} zkontrolovaných emailů`);

  return {
    duplicates,
    archiveFolder,
    gmailAllMail
  };
}

/**
 * Přesune duplicitní emaily do koše vybraného uživatelem
 * Vrací ID skutečně přesunutých zpráv, aby popup mohl zobrazit přesný stav
 */
async function moveDuplicatesToTrash(duplicateIds, trashRef) {
  const trashFolder = trashRef
    ? await findFolder(trashRef)
    : await findGmailTrashFolder();

  if (!trashFolder) {
    throw new Error(`Gmail koš nebyl nalezen${trashRef ? `: ${trashRef.path}` : ''}`);
  }

  const movedIds = [];

  for (let batchStart = 0; batchStart < duplicateIds.length; batchStart += BATCH_SIZE) {
    if (stopState.requested) {
      sendProgress(`⏹ Přesun zastaven po ${movedIds.length} emailech`);
      return { stopped: true, movedIds };
    }

    const batch = duplicateIds.slice(batchStart, batchStart + BATCH_SIZE);
    sendProgress(`Přesouvám emaily ${batchStart + 1}-${batchStart + batch.length}/${duplicateIds.length}`);

    try {
      await messenger.messages.move(batch, trashFolder);
      movedIds.push(...batch);
    } catch (error) {
      // Dávka selhala - zkusíme zprávy po jedné, ať víme které se nepřesunuly
      console.error('Chyba při přesunu dávky, zkouším po jedné:', error);
      for (const id of batch) {
        try {
          await messenger.messages.move([id], trashFolder);
          movedIds.push(id);
        } catch (singleError) {
          console.error(`Chyba při přesunu emailu ${id}:`, singleError);
        }
      }
    }
  }

  sendProgress(`Přesunuto ${movedIds.length} emailů do koše`);
  return { stopped: false, movedIds };
}

// Posluchač zpráv z popup okna
messenger.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'findDuplicates') {
    stopState.requested = false; // Reset flag při nové analýze
    findDuplicates(message.folderRefs)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Asynchronní odpověď
  }

  if (message.action === 'moveDuplicates') {
    stopState.requested = false; // Reset flag při novém přesunu
    moveDuplicatesToTrash(message.duplicateIds, message.gmailTrash)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'stop') {
    stopState.requested = true;
    sendProgress('🛑 STOP signál přijat, zastavuji při nejbližší příležitosti...');
    sendResponse({ success: true });
    return true;
  }
});

// Handler pro kliknutí na položku v Tools menu
messenger.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "open-deduplicator") {
    // Otevře popup v novém okně
    await messenger.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 650,
      height: 500
    });
  }
});
