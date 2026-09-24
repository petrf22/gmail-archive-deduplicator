// fake-messenger.js - Falešné Thunderbird `messenger` API nad JSON fixture
// Klasický skript bez modulů: v prohlížeči nastaví window.FakeMessenger,
// v Node ho driver.mjs spustí přes node:vm a vezme si globalThis.FakeMessenger.
//
// Hub drží data a doručuje runtime zprávy mezi kontexty ("background", "popup").
// Každý kontext dostane vlastní objekt `messenger`; sendMessage doručí zprávu
// posluchačům OSTATNÍCH kontextů, stejně jako skutečné WebExtension API.
//
// Volby: pageDelayMs (zpoždění stránky messages.list/continueList),
//        moveDelayMs (zpoždění jednoho messages.move),
//        failMoveIds (id zpráv, u kterých messages.move selže).

(function (root) {
  'use strict';

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clone = (value) => (value === undefined ? undefined : structuredClone(value));

  function createHub(fixture, options = {}) {
    const opts = { pageDelayMs: 0, moveDelayMs: 0, failMoveIds: [], ...options };
    const pageSize = fixture.pageSize || 100;
    const log = [];
    const contexts = new Map();
    const pages = new Map();
    let pageCounter = 0;

    // Složky: doplníme id/accountId/type jako skutečný MailFolder
    function decorateFolders(account, folders) {
      return (folders || []).map((folder) => ({
        id: `${account.id}:/${folder.path}`,
        accountId: account.id,
        path: folder.path,
        name: folder.name,
        type: folder.type,
        subFolders: decorateFolders(account, folder.subFolders),
      }));
    }

    const accounts = fixture.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      identities: [],
      folders: decorateFolders(account, account.folders),
    }));

    const messages = fixture.messages.map((message) => ({ ...message }));
    const gmailAccount = accounts.find((account) => account.type === 'imap');
    for (let i = 0; i < (fixture.gmailFiller || 0); i++) {
      messages.push({
        id: 1000 + i,
        folder: `${gmailAccount.id}:/[Gmail]/All Mail`,
        headerMessageId: `filler-${i}@test`,
        subject: `Výplňová zpráva ${i}`,
        author: 'filler@example.com',
        date: new Date(Date.UTC(2023, 0, 1) + i * 3600e3).toISOString(),
      });
    }

    function folderKey(folder) {
      if (typeof folder === 'string') {
        // folderId ve tvaru "account1://Archives"
        const [accountId, rest] = folder.split(':/');
        return `${accountId}:${rest}`;
      }
      return `${folder.accountId}:${folder.path}`;
    }

    // Thunderbird zprávě bez hlavičky Message-ID vygeneruje "md5:<base64>" (ověřeno na TB 153),
    // headerMessageId tedy nikdy není prázdné. Napodobíme to (stačí deterministický otisk).
    function syntheticMessageId(message) {
      let hash = 2166136261;
      for (const ch of `${message.subject}|${message.author}|${message.date}`) {
        hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
      }
      return `md5:${hash.toString(36)}`;
    }

    function toHeader(message) {
      const [accountId, path] = [message.folder.slice(0, message.folder.indexOf(':')), message.folder.slice(message.folder.indexOf(':') + 1)];
      return {
        id: message.id,
        headerMessageId: message.headerMessageId || syntheticMessageId(message),
        subject: message.subject,
        author: message.author,
        date: new Date(message.date),
        folder: { accountId, path, id: `${accountId}:/${path}` },
        read: false,
        flagged: false,
        junk: false,
        tags: [],
        recipients: [],
        ccList: [],
        bccList: [],
        size: 1000,
      };
    }

    function takePage(queue) {
      const chunk = queue.splice(0, pageSize);
      let id = null;
      if (queue.length > 0) {
        id = `page-${++pageCounter}`;
        pages.set(id, queue);
      }
      return { id, messages: chunk.map(toHeader) };
    }

    function listeners(contextName) {
      return contexts.get(contextName).listeners;
    }

    async function deliver(fromContext, message) {
      const targets = [...contexts.entries()].filter(([name]) => name !== fromContext);
      let responded = false;
      let response;
      let receiverExists = false;
      for (const [, ctx] of targets) {
        for (const listener of ctx.listeners) {
          receiverExists = true;
          const result = listener(clone(message), { id: 'fake@test' });
          if (!responded && result !== undefined) {
            responded = true;
            response = result;
          }
        }
      }
      if (!receiverExists) {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return clone(await response);
    }

    function context(name) {
      const ctx = { listeners: [] };
      contexts.set(name, ctx);
      const event = (store) => ({
        addListener: (fn) => store.push(fn),
        removeListener: (fn) => store.splice(store.indexOf(fn), 1),
        hasListener: (fn) => store.includes(fn),
      });
      const menuClickListeners = [];

      return {
        accounts: {
          async list(includeFolders) {
            log.push({ ctx: name, call: 'accounts.list', includeFolders });
            return accounts.map((account) => ({ ...clone(account), folders: includeFolders ? clone(account.folders) : undefined }));
          },
          async get(accountId, includeFolders) {
            log.push({ ctx: name, call: 'accounts.get', accountId, includeFolders });
            const account = accounts.find((a) => a.id === accountId);
            if (!account) return null;
            return { ...clone(account), folders: includeFolders ? clone(account.folders) : undefined };
          },
        },
        messages: {
          async list(folder) {
            log.push({ ctx: name, call: 'messages.list', folder: folderKey(folder) });
            await sleep(opts.pageDelayMs);
            const key = folderKey(folder);
            return takePage(messages.filter((m) => m.folder === key));
          },
          async continueList(pageId) {
            log.push({ ctx: name, call: 'messages.continueList', pageId });
            await sleep(opts.pageDelayMs);
            const queue = pages.get(pageId);
            if (!queue) throw new Error(`Neznámá stránka ${pageId}`);
            pages.delete(pageId);
            return takePage(queue);
          },
          async move(ids, folder) {
            log.push({ ctx: name, call: 'messages.move', ids: [...ids], folder: folderKey(folder) });
            await sleep(opts.moveDelayMs);
            if (ids.some((id) => opts.failMoveIds.includes(id))) {
              throw new Error(`Simulované selhání přesunu (${ids.join(',')})`);
            }
            const key = folderKey(folder);
            for (const id of ids) {
              const message = messages.find((m) => m.id === id);
              if (!message) throw new Error(`Zpráva ${id} neexistuje`);
              message.folder = key;
            }
          },
        },
        menus: {
          create(props) {
            log.push({ ctx: name, call: 'menus.create', props });
            return props.id;
          },
          onClicked: event(menuClickListeners),
        },
        windows: {
          async create(props) {
            log.push({ ctx: name, call: 'windows.create', props });
            return { id: 1, ...props };
          },
        },
        runtime: {
          sendMessage: (message) => deliver(name, message),
          onMessage: event(ctx.listeners),
          getManifest: () => clone(fixture.manifest || { version: '0.0.0-fake' }),
        },
      };
    }

    return {
      context,
      log,
      // Aktuální obsah složky "accountId:/path" (pro ověření po přesunu)
      folderContents: (key) => messages.filter((m) => m.folder === key).map((m) => m.id),
      listeners,
    };
  }

  root.FakeMessenger = { createHub };
})(typeof window !== 'undefined' ? window : globalThis);
