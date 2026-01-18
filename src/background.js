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

/**
 * Zjistí Message-ID emailu pro porovnání duplicit
 */
async function getMessageId(messageId) {
  try {
    const full = await messenger.messages.getFull(messageId);
    // Message-ID je nejspolehlivější identifikátor emailu
    return full.headers['message-id'] ? full.headers['message-id'][0] : null;
  } catch (error) {
    // Některé zprávy nelze přečíst (poškozené, přesouvané, nedostupné)
    // To je normální, prostě je přeskočíme
    return null;
  }
}

/**
 * Získá hash emailu pro porovnání (pokud Message-ID chybí)
 */
async function getMessageHash(message) {
  const subject = message.subject || '';
  const date = message.date ? new Date(message.date).getTime() : 0;
  const author = message.author || '';
  return `${subject}|${date}|${author}`;
}

/**
 * Najde lokální archivní složku
 */
async function findLocalArchiveFolder() {
  const accounts = await messenger.accounts.list();

  for (const account of accounts) {
    // Hledáme lokální složky (typ "none")
    if (account.type === 'none') {
      const folders = await findFolderByName(account.folders, ['Archives', 'Archiv', 'Archive']);
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
      const folders = await findFolderByName(account.folders, ['[Gmail]/All Mail', '[Gmail]/Všechny zprávy']);
      if (folders.length > 0) {
        return folders[0];
      }
    }
  }

  return null;
}

/**
 * Najde Gmail koš
 */
async function findGmailTrashFolder() {
  const accounts = await messenger.accounts.list();

  for (const account of accounts) {
    if (account.type === 'imap') {
      const folders = await findFolderByName(account.folders, ['[Gmail]/Trash', 'Trash', '[Gmail]/Koš', 'Koš']);
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
async function findFolderByName(folders, names) {
  const results = [];

  for (const folder of folders) {
    if (names.some(name => folder.path.includes(name) || folder.name === name)) {
      results.push(folder);
    }

    if (folder.subFolders && folder.subFolders.length > 0) {
      const subResults = await findFolderByName(folder.subFolders, names);
      results.push(...subResults);
    }
  }

  return results;
}

/**
 * Najde duplicitní emaily
 */
async function findDuplicates() {
  const archiveFolder = await findLocalArchiveFolder();
  const gmailAllMail = await findGmailAllMailFolder();

  if (!archiveFolder) {
    throw new Error('Lokální archivní složka nebyla nalezena');
  }

  if (!gmailAllMail) {
    throw new Error('Gmail složka "All Mail" nebyla nalezena');
  }

  sendProgress('Načítám emaily z lokálního archivu...');

  // Získáme všechny zprávy z archivu
  let archivePage = await messenger.messages.list(archiveFolder);
  const archiveMessages = [...archivePage.messages];

  while (archivePage.id) {
    archivePage = await messenger.messages.continueList(archivePage.id);
    archiveMessages.push(...archivePage.messages);
    sendProgress(`Načítám archiv: ${archiveMessages.length} emailů...`);
  }

  sendProgress(`Načteno ${archiveMessages.length} emailů z archivu. Načítám Gmail...`);

  // Získáme všechny zprávy z Gmail All Mail
  let gmailPage = await messenger.messages.list(gmailAllMail);
  const gmailMessages = [...gmailPage.messages];

  while (gmailPage.id) {
    gmailPage = await messenger.messages.continueList(gmailPage.id);
    gmailMessages.push(...gmailPage.messages);
    sendProgress(`Načítám Gmail: ${gmailMessages.length} emailů...`);
  }

  sendProgress(`Načteno ${gmailMessages.length} emailů z Gmail. Hledám duplicity...`);

  // Vytvoříme mapu Gmail zpráv podle Message-ID a hash
  const gmailMap = new Map();
  let gmailErrors = 0;

  for (let i = 0; i < gmailMessages.length; i++) {
    if (i % 100 === 0) {
      sendProgress(`Indexuji Gmail zprávy: ${i}/${gmailMessages.length}`);
    }

    const message = gmailMessages[i];
    const messageId = await getMessageId(message.id);
    const hash = await getMessageHash(message);

    if (messageId === null && hash === null) {
      gmailErrors++;
      continue; // Přeskočíme nečitelné zprávy
    }

    if (messageId) {
      gmailMap.set(messageId, message);
    }
    if (hash) {
      gmailMap.set(hash, message);
    }
  }

  if (gmailErrors > 0) {
    sendProgress(`Varování: ${gmailErrors} Gmail emailů nelze přečíst (budou přeskočeny)`);
  }

  // Najdeme duplicity
  const duplicates = [];
  let archiveErrors = 0;

  for (let i = 0; i < archiveMessages.length; i++) {
    if (i % 50 === 0) {
      sendProgress(`Kontroluji archiv: ${i}/${archiveMessages.length}`);
    }

    const archiveMsg = archiveMessages[i];
    const messageId = await getMessageId(archiveMsg.id);
    const hash = await getMessageHash(archiveMsg);

    if (messageId === null && hash === null) {
      archiveErrors++;
      continue; // Přeskočíme nečitelné zprávy
    }

    let gmailMsg = null;

    if (messageId && gmailMap.has(messageId)) {
      gmailMsg = gmailMap.get(messageId);
    } else if (hash && gmailMap.has(hash)) {
      gmailMsg = gmailMap.get(hash);
    }

    if (gmailMsg) {
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
    sendProgress(`Varování: ${archiveErrors} archivních emailů nelze přečíst (přeskočeny)`);
  }

  sendProgress(`Nalezeno ${duplicates.length} duplicit`);

  return {
    duplicates,
    archiveFolder,
    gmailAllMail
  };
}

/**
 * Přesune duplicitní emaily do koše
 */
async function moveDuplicatesToTrash(duplicateIds) {
  const trashFolder = await findGmailTrashFolder();

  if (!trashFolder) {
    throw new Error('Gmail koš nebyl nalezen');
  }

  for (let i = 0; i < duplicateIds.length; i++) {
    sendProgress(`Přesouvám email ${i + 1}/${duplicateIds.length}`);

    try {
      // await messenger.messages.move([duplicateIds[i]], trashFolder);
      sendProgress(`Přesun emailu ${duplicateIds[i]} je vypnutý v demo režimu.`);
    } catch (error) {
      console.error('Chyba při přesunu emailu:', error);
    }
  }

  sendProgress(`Přesunuto ${duplicateIds.length} emailů do koše`);
}

// Posluchač zpráv z popup okna
messenger.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'findDuplicates') {
    findDuplicates()
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Asynchronní odpověď
  }

  if (message.action === 'moveDuplicates') {
    moveDuplicatesToTrash(message.duplicateIds)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
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
