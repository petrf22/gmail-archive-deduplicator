// background.ts - Hlavní logika doplňku

import {
  STOPPED_MESSAGE,
  type BackgroundRequest,
  type Duplicate,
  type FindDuplicatesRequest,
  type FindDuplicatesResult,
  type FolderRef,
  type MailFolder,
  type MessageHeader,
  type MoveResult,
  type ProgressMessage,
  type ResponseFor,
} from './types';

interface GmailIndex {
  byMessageId: Map<string, MessageHeader>;
  byHash: Map<string, MessageHeader>;
}

// Vytvoření položky v menu Nástroje při startu
messenger.menus.create({
  id: "open-deduplicator",
  title: "Gmail Archive Deduplicator",
  contexts: ["tools_menu"]
});

// Pomocná funkce pro posílání progress zpráv do popup
function sendProgress(message: string): void {
  const progress: ProgressMessage = { action: 'progress', message };
  // Posíláme zprávu všem otevřeným popup oknům
  messenger.runtime.sendMessage(progress).catch(() => {
    // Ignorujeme chyby pokud popup není otevřený
  });
}

// Globální flag pro zastavení operace - OBJEKT pro sdílenou referenci mezi vlákny
const stopState = { requested: false };

const BATCH_SIZE = 50;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Najde složku podle účtu a cesty ({accountId, path})
 * Samotná cesta není unikátní - např. "/Trash" existuje v lokálních složkách i v IMAP účtu
 */
async function findFolder(folderRef: FolderRef | undefined): Promise<MailFolder | null> {
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
function searchFolderByPath(folders: MailFolder[] | undefined, targetPath: string): MailFolder | null {
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
 * Zprávám bez hlavičky Message-ID Thunderbird vygeneruje "md5:..." - to bereme jako chybějící,
 * jinak by se takové zprávy nikdy nespárovaly přes hash
 */
function getMessageId(message: MessageHeader): string | null {
  const messageId = message.headerMessageId;
  if (!messageId || messageId.startsWith('md5:')) {
    return null;
  }
  return messageId;
}

/**
 * Získá hash emailu pro porovnání (pokud Message-ID chybí)
 * Bez předmětu, autora nebo data by hash nebyl dostatečně jedinečný
 */
function getMessageHash(message: MessageHeader): string | null {
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
async function listFolderMessages(folder: MailFolder, onPage: (count: number) => void): Promise<MessageHeader[]> {
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
async function getAllMessagesFromFolderFast(folder: MailFolder, progressPrefix = ''): Promise<MessageHeader[]> {
  sendProgress(`${progressPrefix} - Rychlé načítání...`);

  const allMessages: MessageHeader[] = [];
  const folderQueue: { folder: MailFolder; path: string }[] = [{ folder, path: '' }];

  while (folderQueue.length > 0) {
    if (stopState.requested) {
      sendProgress(`Načítání archivu zastaveno po ${allMessages.length} emailech`);
      throw new Error(STOPPED_MESSAGE);
    }

    const current = folderQueue.shift()!;
    const indent = current.path ? '  ' : '';

    try {
      const folderMessages = await listFolderMessages(current.folder, () => {});

      if (folderMessages.length > 0) {
        allMessages.push(...folderMessages);
        sendProgress(`${progressPrefix} - ${indent}${current.folder.name}: ${folderMessages.length} emailů (celkem: ${allMessages.length})`);
      }
    } catch (error) {
      if (errorMessage(error) === STOPPED_MESSAGE) {
        sendProgress(`Načítání archivu zastaveno po ${allMessages.length} emailech`);
        throw error;
      }
      console.log(`Nelze načíst zprávy ze složky ${current.folder.name}:`, errorMessage(error));
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
async function loadGmailMessages(folder: MailFolder): Promise<MessageHeader[]> {
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
    if (errorMessage(error) === STOPPED_MESSAGE) {
      sendProgress(`⏹ Načítání Gmail zastaveno po ${loaded} emailech`);
    }
    throw error;
  }
}

/**
 * Najde první složku odpovídající jménům v účtech daného typu
 */
async function findFolderInAccounts(accountType: string, names: string[], accountId: string | null = null): Promise<MailFolder | null> {
  const accounts = await messenger.accounts.list(true);

  for (const account of accounts) {
    if (account.type === accountType && (!accountId || account.id === accountId)) {
      const folders = findFolderByName(account.folders, names);
      if (folders.length > 0) {
        return folders[0];
      }
    }
  }

  return null;
}

/**
 * Najde lokální archivní složku (lokální složky mají typ účtu "none")
 */
function findLocalArchiveFolder(): Promise<MailFolder | null> {
  return findFolderInAccounts('none', ['Archives', 'Archiv', 'Archive']);
}

/**
 * Najde Gmail složku "All Mail"
 */
function findGmailAllMailFolder(): Promise<MailFolder | null> {
  return findFolderInAccounts('imap', ['[Gmail]/All Mail', 'All Mail', '[Gmail]/Všechny zprávy', '[Gmail]/Všechna pošta']);
}

/**
 * Najde Gmail koš v daném účtu (nebo v prvním IMAP účtu, který ho má)
 */
function findGmailTrashFolder(accountId: string | null = null): Promise<MailFolder | null> {
  return findFolderInAccounts('imap', ['[Gmail]/Trash', 'Trash', '[Gmail]/Koš', 'Koš'], accountId);
}

/**
 * Rekurzivně prohledá složky podle jména
 */
function findFolderByName(folders: MailFolder[] | undefined, names: string[]): MailFolder[] {
  const results: MailFolder[] = [];

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
function indexGmailMessages(gmailMessages: MessageHeader[]): GmailIndex {
  const byMessageId = new Map<string, MessageHeader>();
  const byHash = new Map<string, MessageHeader>();
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
function findDuplicatesInArchive(archiveMessages: MessageHeader[], gmailIndex: GmailIndex): Duplicate[] {
  const duplicates: Duplicate[] = [];
  const processedGmailIds = new Set<number>();
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

    let gmailMsg: MessageHeader | null = null;

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

async function findDuplicates(folderRefs?: FindDuplicatesRequest['folderRefs']): Promise<FindDuplicatesResult> {
  let archiveFolder: MailFolder | null;
  let gmailAllMail: MailFolder | null;

  if (folderRefs) {
    // Použij složky vybrané uživatelem
    sendProgress('Načítám vybrané složky...');
    [archiveFolder, gmailAllMail] = await Promise.all([
      findFolder(folderRefs.archiveFolder),
      findFolder(folderRefs.gmailAllMail)
    ]);

    if (!archiveFolder) {
      throw new Error(`Archivní složka nenalezena: ${folderRefs.archiveFolder.path}`);
    }
    if (!gmailAllMail) {
      throw new Error(`Gmail All Mail nenalezen: ${folderRefs.gmailAllMail.path}`);
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
async function moveDuplicatesToTrash(duplicateIds: number[], trashRef?: FolderRef): Promise<MoveResult> {
  const trashFolder = trashRef
    ? await findFolder(trashRef)
    : await findGmailTrashFolder();

  if (!trashFolder) {
    throw new Error(`Gmail koš nebyl nalezen${trashRef ? `: ${trashRef.path}` : ''}`);
  }

  const movedIds: number[] = [];

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

/**
 * Zpracuje požadavek z popup a vrátí typovanou odpověď
 */
async function handleRequest(request: BackgroundRequest): Promise<ResponseFor[BackgroundRequest['action']]> {
  switch (request.action) {
    case 'findDuplicates':
      stopState.requested = false; // Reset flag při nové analýze
      try {
        return { success: true, data: await findDuplicates(request.folderRefs) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }

    case 'moveDuplicates':
      stopState.requested = false; // Reset flag při novém přesunu
      try {
        return { success: true, ...await moveDuplicatesToTrash(request.duplicateIds, request.gmailTrash) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }

    case 'stop':
      stopState.requested = true;
      sendProgress('🛑 STOP signál přijat, zastavuji při nejbližší příležitosti...');
      return { success: true };
  }
}

// Posluchač zpráv z popup okna
messenger.runtime.onMessage.addListener((message: BackgroundRequest | ProgressMessage) => {
  if (message.action === 'progress') {
    // Progress zprávy jsou určené pro popup
    return;
  }
  // Vrácený Promise je asynchronní odpověď
  return handleRequest(message);
});

// Handler pro kliknutí na položku v Tools menu
messenger.menus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "open-deduplicator") {
    // Otevře popup v novém okně
    await messenger.windows.create({
      url: 'popup.html',
      type: 'popup',
      width: 650,
      height: 750
    });
  }
});
