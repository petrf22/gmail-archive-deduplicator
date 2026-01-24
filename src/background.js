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

// Globální proměnná pro uložení trash složky
let currentGmailTrash = null;

// Globální flag pro zastavení operace - OBJEKT pro sdílenou referenci mezi vlákny
const stopState = { requested: false };

/**
 * Najde složku podle cesty
 */
async function findFolderByPath(path) {
  const accounts = await messenger.accounts.list();
  
  for (const account of accounts) {
    const folder = await searchFolderByPath(account.folders, path);
    if (folder) {
      return folder;
    }
  }
  
  return null;
}

/**
 * Rekurzivně hledá složku podle cesty
 */
async function searchFolderByPath(folders, targetPath) {
  if (!folders) return null;
  
  for (const folder of folders) {
    if (folder.path === targetPath) {
      return folder;
    }
    
    if (folder.subFolders && folder.subFolders.length > 0) {
      const found = await searchFolderByPath(folder.subFolders, targetPath);
      if (found) return found;
    }
  }
  
  return null;
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
 * Rychlé načtení všech zpráv pomocí Query API s paginací
 */
async function getAllMessagesWithQuery(folder, progressPrefix = '') {
  sendProgress(`${progressPrefix} - Používám rychlé indexované vyhledávání...`);
  
  try {
    let allMessages = [];
    let offset = 0;
    const batchSize = 1000; // Načítáme po 1000
    
    while (true) {
      // Query s limitem a offsetem
      const result = await messenger.messages.query({
        folder: folder,
        includeSubFolders: true,
        // Thunderbird podporuje limit, ale ne offset - musíme použít jiný přístup
      });
      
      if (!result || !result.messages || result.messages.length === 0) {
        break;
      }
      
      allMessages.push(...result.messages);
      sendProgress(`${progressPrefix} - Načteno ${allMessages.length} emailů...`);
      
      // Pokud jsme dostali méně než očekáváme, jsme na konci
      if (result.messages.length < 100) {
        break;
      }
      
      // PROBLÉM: Query API nemá offset!
      // Fallback na pomalou metodu
      throw new Error('Query API pagination not supported');
    }
    
    return allMessages;
    
  } catch (error) {
    // Fallback na rekurzivní metodu
    sendProgress(`${progressPrefix} - Přepínám na standardní metodu...`);
    return await getAllMessagesFromFolder(folder, progressPrefix, 0);
  }
}

/**
 * HYBRIDNÍ PŘÍSTUP: Rychlé načtení bez rekurze
 * Použije messages.list() ale bez zbytečné rekurze do podsložek
 */
async function getAllMessagesFromFolderFast(folder, progressPrefix = '') {
  sendProgress(`${progressPrefix} - Rychlé načítání...`);
  
  let allMessages = [];
  let folderQueue = [{ folder, path: '' }];
  
  while (folderQueue.length > 0) {
    if (stopState.requested) {
      sendProgress(`Načítání archivu zastaveno po ${allMessages.length} emailech`);
      throw new Error('Operace zastavena uživatelem');
    }
    
    const current = folderQueue.shift();
    const indent = current.path ? '  ' : '';
    
    try {
      // Načti zprávy z aktuální složky (se stránkováním)
      let page = await messenger.messages.list(current.folder);
      const folderMessages = [...page.messages];
      
      while (page.id) {
        if (stopState.requested) {
          sendProgress(`Načítání archivu zastaveno po ${allMessages.length} emailech`);
          throw new Error('Operace zastavena uživatelem');
        }
        
        page = await messenger.messages.continueList(page.id);
        folderMessages.push(...page.messages);
      }
      
      if (folderMessages.length > 0) {
        allMessages.push(...folderMessages);
        sendProgress(`${progressPrefix} - ${indent}${current.folder.name}: ${folderMessages.length} emailů (celkem: ${allMessages.length})`);
      }
      
      // Přidej podsložky do fronty (ne rekurze!)
      if (current.folder.subFolders && current.folder.subFolders.length > 0) {
        for (const subFolder of current.folder.subFolders) {
          folderQueue.push({ 
            folder: subFolder, 
            path: current.path + '/' + subFolder.name 
          });
        }
      }
      
    } catch (error) {
      console.log(`Nelze načíst zprávy ze složky ${current.folder.name}:`, error.message);
    }
  }
  
  sendProgress(`${progressPrefix} - Celkem načteno ${allMessages.length} emailů`);
  return allMessages;
}


/**
 * Rekurzivně načte všechny zprávy ze složky a jejích podsložek
 */
async function getAllMessagesFromFolder(folder, progressPrefix = '', depth = 0) {
  let allMessages = [];
  const indent = '  '.repeat(depth);
  
  // Načteme zprávy z aktuální složky
  try {
    sendProgress(`${progressPrefix} - ${indent}${folder.name || 'Archiv'}...`);
    
    let page = await messenger.messages.list(folder);
    allMessages = [...page.messages];
    
    while (page.id) {
      page = await messenger.messages.continueList(page.id);
      allMessages.push(...page.messages);
    }
    
    if (allMessages.length > 0) {
      sendProgress(`${progressPrefix} - ${indent}${folder.name || 'Archiv'}: ${allMessages.length} emailů`);
    }
  } catch (error) {
    console.log(`Nelze načíst zprávy ze složky ${folder.name}:`, error.message);
  }
  
  // Rekurzivně projdeme všechny podsložky
  if (folder.subFolders && folder.subFolders.length > 0) {
    for (const subFolder of folder.subFolders) {
      const subMessages = await getAllMessagesFromFolder(subFolder, progressPrefix, depth + 1);
      allMessages.push(...subMessages);
    }
  }
  
  return allMessages;
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
      const folders = await findFolderByName(account.folders, ['[Gmail]/All Mail', 'All Mail', '[Gmail]/Všechny zprávy']);
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
 * Najde duplicitní emaily (nová paralelní metoda)
 * Pro každý email z archivu okamžitě hledá v Gmailu
 */
async function findDuplicates(folderPaths = null) {
  let archiveFolder, gmailAllMail;
  
  if (folderPaths) {
    // Použij složky vybrané uživatelem
    sendProgress('Načítám vybrané složky...');
    // Paralelní načtení všech složek najednou
    [archiveFolder, gmailAllMail, currentGmailTrash] = await Promise.all([
      findFolderByPath(folderPaths.archiveFolder),
      findFolderByPath(folderPaths.gmailAllMail),
      findFolderByPath(folderPaths.gmailTrash)
    ]);
    
    if (!archiveFolder) {
      throw new Error(`Archivní složka nenalezena: ${folderPaths.archiveFolder}`);
    }
    if (!gmailAllMail) {
      throw new Error(`Gmail All Mail nenalezen: ${folderPaths.gmailAllMail}`);
    }
    if (!currentGmailTrash) {
      throw new Error(`Gmail Koš nenalezen: ${folderPaths.gmailTrash}`);
    }
  } else {
    // Původní automatická detekce (fallback)
    // Paralelní automatická detekce
    [archiveFolder, gmailAllMail, currentGmailTrash] = await Promise.all([
      findLocalArchiveFolder(),
      findGmailAllMailFolder(),
      findGmailTrashFolder()
    ]);
    
    if (!archiveFolder) {
      throw new Error('Lokální archivní složka nebyla nalezena');
    }
    if (!gmailAllMail) {
      throw new Error('Gmail složka "All Mail" nebyla nalezena');
    }
  }
  

  // Pomocná funkce pro načtení Gmail zpráv
  async function loadGmailMessages(folder) {
    let page = await messenger.messages.list(folder);
    const messages = [...page.messages];
    
    sendProgress(`Načítám Gmail: ${messages.length} emailů...`);

    while (page.id) {
      // Kontrola PŘED načtením další stránky
      if (stopState.requested) {
        sendProgress(`⏹ Načítání Gmail zastaveno po ${messages.length} emailech`);
        throw new Error('Operace zastavena uživatelem');
      }
      
      page = await messenger.messages.continueList(page.id);
      
      // Kontrola HNED PO načtení (pro rychlejší reakci)
      if (stopState.requested) {
        sendProgress(`⏹ Načítání Gmail zastaveno po ${messages.length} emailech (před přidáním)`);
        throw new Error('Operace zastavena uživatelem');
      }
      
      messages.push(...page.messages);
      
      // Progress každých 500 emailů (častěji)
      if (messages.length % 500 === 0) {
        sendProgress(`Načítám Gmail: ${messages.length} emailů...`);
      }
    }

    return messages;
  }

  sendProgress('Načítám emaily paralelně z archivu i Gmail...');

  // PARALELNÍ načtení archivu i Gmail najednou!
  const [archiveMessages, gmailMessages] = await Promise.all([
    getAllMessagesFromFolderFast(archiveFolder, 'Archiv'),
    loadGmailMessages(gmailAllMail)
  ]);

  sendProgress(`Načteno ${archiveMessages.length} emailů z archivu a ${gmailMessages.length} z Gmail. Hledám duplicity...`);

  // Vytvoříme mapu Gmail zpráv podle Message-ID a hash
  const gmailMap = new Map();
  let gmailErrors = 0;

  // Zpracování v dávkách pro lepší výkon a progress reporting
  const BATCH_SIZE = 50;

  for (let batchStart = 0; batchStart < gmailMessages.length; batchStart += BATCH_SIZE) {
    if (stopState.requested) {
      throw new Error('Operace zastavena uživatelem');
    }
    
    const batchEnd = Math.min(batchStart + BATCH_SIZE, gmailMessages.length);
    const batch = gmailMessages.slice(batchStart, batchEnd);

    sendProgress(`Indexuji Gmail zprávy: ${batchStart}/${gmailMessages.length}`);

    // Paralelní zpracování celé dávky
    const results = await Promise.all(
      batch.map(async (message) => {
        const [messageId, hash] = await Promise.all([
          getMessageId(message.id),
          getMessageHash(message)
        ]);
        return { message, messageId, hash };
      })
    );

    // Sekvenční zápis do mapy (Map není thread-safe)
    for (const { message, messageId, hash } of results) {
      if (messageId === null && hash === null) {
        gmailErrors++;
        continue;
      }

      if (messageId) {
        gmailMap.set(messageId, message);
      }
      if (hash) {
        gmailMap.set(hash, message);
      }
    }
  }
  if (gmailErrors > 0) {
    sendProgress(`Varování: ${gmailErrors} Gmail emailů nelze přečíst (přeskočeny)`);
  }

  // Najdeme duplicity
  const duplicates = [];
  const processedGmailIds = new Set();
  let archiveErrors = 0;

  for (let batchStart = 0; batchStart < archiveMessages.length; batchStart += BATCH_SIZE) {
    if (stopState.requested) {
      throw new Error('Operace zastavena uživatelem');
    }
    
    const batchEnd = Math.min(batchStart + BATCH_SIZE, archiveMessages.length);
    const batch = archiveMessages.slice(batchStart, batchEnd);

    sendProgress(`Kontroluji archiv: ${batchStart}/${archiveMessages.length}`);

    // Paralelní získání messageId a hash pro celou dávku
    const results = await Promise.all(
      batch.map(async (archiveMsg) => {
        const [messageId, hash] = await Promise.all([
          getMessageId(archiveMsg.id),
          getMessageHash(archiveMsg)
        ]);
        return { archiveMsg, messageId, hash };
      })
    );

    // Sekvenční zpracování výsledků (kvůli processedGmailIds)
    for (const { archiveMsg, messageId, hash } of results) {
      if (messageId === null && hash === null) {
        archiveErrors++;
        continue;
      }

      let gmailMsg = null;

      // Zkusíme najít podle Message-ID
      if (messageId && gmailMap.has(messageId)) {
        gmailMsg = gmailMap.get(messageId);
      }

      // Pokud nenalezen, zkusíme hash
      if (!gmailMsg && hash && gmailMap.has(hash)) {
        gmailMsg = gmailMap.get(hash);
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
  }

  if (archiveErrors > 0) {
    sendProgress(`Varování: ${archiveErrors} archivních emailů nelze přečíst (přeskočeny)`);
  }
  
  sendProgress(`Analýza dokončena. Nalezeno ${duplicates.length} duplicit z ${archiveMessages.length} zkontrolovaných emailů`);
  
  return {
    duplicates,
    archiveFolder,
    gmailAllMail
  };
}

/**
 * Rekurzivně prochází složku archivu a hledá každý email v Gmailu
 */
async function findDuplicatesInFolder(archiveFolder, gmailFolder, duplicates, processedCount, gmailErrors, depth = 0) {
  const indent = '  '.repeat(depth);
  sendProgress(`Procházím ${indent}${archiveFolder.name || 'Archiv'}...`);
  
  // Načteme zprávy z aktuální složky
  try {
    let page = await messenger.messages.list(archiveFolder);
    
    do {
      // Zpracujeme každou zprávu na této stránce
      for (const archiveMsg of page.messages) {
        processedCount++;
        
        if (processedCount % 10 === 0) {
          sendProgress(`Zkontrolováno: ${processedCount} emailů, nalezeno: ${duplicates.length} duplicit`);
        }
        
        // Získáme Message-ID a hash archivního emailu
        const archiveMessageId = await getMessageId(archiveMsg.id);
        const archiveHash = await getMessageHash(archiveMsg);
        
        if (!archiveMessageId && !archiveHash) {
          continue; // Přeskočíme nečitelné zprávy
        }
        
        // Hledáme tento email v Gmailu
        const gmailMatch = await findMessageInFolder(
          gmailFolder, 
          archiveMessageId, 
          archiveHash
        );
        
        if (gmailMatch) {
          // Našli jsme duplicitu!
          duplicates.push({
            archiveMessage: archiveMsg,
            gmailMessage: gmailMatch,
            messageId: archiveMessageId,
            subject: archiveMsg.subject,
            date: archiveMsg.date,
            author: archiveMsg.author
          });
        }
      }
      
      // Pokračujeme na další stránku
      if (page.id) {
        page = await messenger.messages.continueList(page.id);
      } else {
        break;
      }
    } while (page.id);
    
  } catch (error) {
    console.log(`Chyba při procházení složky ${archiveFolder.name}:`, error.message);
  }
  
  // Rekurzivně projdeme podsložky
  if (archiveFolder.subFolders && archiveFolder.subFolders.length > 0) {
    for (const subFolder of archiveFolder.subFolders) {
      await findDuplicatesInFolder(subFolder, gmailFolder, duplicates, processedCount, gmailErrors, depth + 1);
    }
  }
}

/**
 * Hledá konkrétní zprávu v Gmail složce podle Message-ID nebo hash
 */
async function findMessageInFolder(folder, messageId, hash) {
  try {
    // Použijeme Query API pro vyhledání konkrétního emailu
    if (messageId) {
      // Zkusíme najít podle předmětu a odesílatele (Query API podporuje)
      const [subject, timestamp, author] = hash ? hash.split('|') : [null, null, null];
      
      if (subject && author) {
        const result = await messenger.messages.query({
          folder: folder,
          author: author,
          subject: subject
        });
        
        // Projdeme výsledky a hledáme shodu v Message-ID
        if (result.messages && result.messages.length > 0) {
          for (const msg of result.messages) {
            const msgId = await getMessageId(msg.id);
            if (msgId === messageId) {
              return msg; // Našli jsme přesnou shodu!
            }
          }
        }
      }
    }
    
    // Fallback: hledání podle hash (předmět + datum + autor)
    if (hash) {
      const [subject, timestamp, author] = hash.split('|');
      
      if (subject && author) {
        const result = await messenger.messages.query({
          folder: folder,
          subject: subject,
          author: author
        });
        
        // Ověříme datum (může být více emailů se stejným předmětem)
        if (result.messages && result.messages.length > 0) {
          for (const msg of result.messages) {
            const msgTimestamp = msg.date ? new Date(msg.date).getTime() : 0;
            const targetTimestamp = parseInt(timestamp);
            // Povolíme odchylku 1 minuta (60000 ms)
            if (Math.abs(msgTimestamp - targetTimestamp) < 60000) {
              return msg;
            }
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    // Query API může selhat, to je OK - není to duplicita
    return null;
  }
}

/**
 * Přesune duplicitní emaily do koše
 */
async function moveDuplicatesToTrash(duplicateIds) {
  const trashFolder = currentGmailTrash || await findGmailTrashFolder();
  
  if (!trashFolder) {
    throw new Error('Gmail koš nebyl nalezen');
  }
  
  for (let i = 0; i < duplicateIds.length; i++) {
    if (stopState.requested) {
      sendProgress(`Zastaveno po ${i} přesunutých emailech`);
      throw new Error('Operace zastavena uživatelem');
    }
    
    sendProgress(`Přesouvám email ${i + 1}/${duplicateIds.length}`);
    
    try {
      await messenger.messages.move([duplicateIds[i]], trashFolder);
    } catch (error) {
      console.error('Chyba při přesunu emailu:', error);
    }
  }
  
  sendProgress(`Přesunuto ${duplicateIds.length} emailů do koše`);
}

// Posluchač zpráv z popup okna
messenger.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'findDuplicates') {
    stopState.requested = false; // Reset flag při nové analýze
    findDuplicates(message.folderPaths)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Asynchronní odpověď
  }
  
  if (message.action === 'moveDuplicates') {
    stopState.requested = false; // Reset flag při novém přesunu
    moveDuplicatesToTrash(message.duplicateIds)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  if (message.action === 'stop') {
    stopState.requested = true;
    console.log('🛑 STOP požadavek přijat! stopState.requested = true');
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
