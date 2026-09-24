#!/usr/bin/env node
// driver.mjs - Spouští a ovládá doplněk Gmail Archive Deduplicator bez skutečného Gmailu
//
// Použití (z kořene repozitáře, po `npm run build`):
//   node .claude/skills/run-gmail-archive-deduplicator/driver.mjs bg [scénář|all]
//   node .claude/skills/run-gmail-archive-deduplicator/driver.mjs send '<json požadavek>' [volby]
//   node .claude/skills/run-gmail-archive-deduplicator/driver.mjs ui [volby]
//   node .claude/skills/run-gmail-archive-deduplicator/driver.mjs tb [volby]
//
// Volby:
//   --fixture <soubor>    jiná testovací data (výchozí fixture.json vedle driveru)
//   --page-delay <ms>     zpoždění každé stránky messages.list/continueList
//   --move-delay <ms>     zpoždění každého messages.move
//   --fail-move <id,id>   messages.move s těmito id selže
//   --out <adresář>       kam ukládat screenshoty (výchozí /tmp/gad-shots)
//   --size <šxv>          velikost okna popupu (výchozí 650x500, jako windows.create)
//   --stop                ui: během hledání klikne na Zastavit
//   --eval '<js>'         ui: po načtení vyhodnotí JS v popupu, vypíše výsledek, udělá screenshot a skončí
//   --keep-profile        tb: nemazat dočasný profil (cesta se vypíše)
//   --verbose             tb: stderr Thunderbirdu na konzoli; send: progress zprávy

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SKILL_DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(SKILL_DIR, '../../..');
const DIST = join(REPO, 'dist');

// ---------- argumenty ----------
const argv = process.argv.slice(2);
const command = argv[0];
const positional = [];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const name = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[name] = true;
    else { flags[name] = next; i++; }
  } else positional.push(argv[i]);
}

function hubOptions() {
  return {
    pageDelayMs: Number(flags['page-delay'] || 0),
    moveDelayMs: Number(flags['move-delay'] || 0),
    failMoveIds: flags['fail-move'] ? String(flags['fail-move']).split(',').map(Number) : [],
  };
}

function loadFixture() {
  const file = flags.fixture ? resolve(flags.fixture) : join(SKILL_DIR, 'fixture.json');
  const fixture = JSON.parse(readFileSync(file, 'utf8'));
  fixture.manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
  return fixture;
}

function requireDist() {
  if (!existsSync(join(DIST, 'background.js'))) {
    console.error('dist/background.js neexistuje - nejdřív spusťte `npm run build`');
    process.exit(2);
  }
}

// ---------- bg: background.js v Node s falešným messengerem ----------
vm.runInThisContext(readFileSync(join(SKILL_DIR, 'fake-messenger.js'), 'utf8'), { filename: 'fake-messenger.js' });
const { createHub } = globalThis.FakeMessenger;

/**
 * Spustí dist/background.js s vlastním `messenger` (parametr funkce zastíní globál)
 * a vrátí "popup" stranu, přes kterou se posílají požadavky.
 */
function startBackground(options = hubOptions()) {
  requireDist();
  const hub = createHub(loadFixture(), options);
  const bgSource = readFileSync(join(DIST, 'background.js'), 'utf8');
  new Function('messenger', bgSource)(hub.context('background'));
  const popup = hub.context('popup');
  const progress = [];
  popup.runtime.onMessage.addListener((message) => {
    if (message.action === 'progress') {
      progress.push(message.message);
      if (flags.verbose) console.log(`    progress: ${message.message}`);
    }
  });
  return { hub, popup, progress, send: (request) => popup.runtime.sendMessage(request) };
}

const REFS = {
  archiveFolder: { accountId: 'account1', path: '/Archives' },
  gmailAllMail: { accountId: 'account2', path: '/[Gmail]/All Mail' },
};
const TRASH = { accountId: 'account2', path: '/[Gmail]/Trash' };
// 103 by se párovalo přes hash, ale TB dává zprávám bez Message-ID syntetické "md5:…" ID
// (fake-messenger to napodobuje), takže hash větev findDuplicatesInArchive se nepoužije
const EXPECTED_DUPLICATES = [101, 102, 106];
const sortNum = (list) => [...list].sort((a, b) => a - b);
const same = (a, b) => JSON.stringify(sortNum(a)) === JSON.stringify(sortNum(b));

function summarize(response) {
  if (response?.success && response.data?.duplicates) {
    return {
      success: true,
      duplicates: response.data.duplicates.map((d) => `${d.archiveMessage.id}->${d.gmailMessage.id} ${d.messageId ?? '(hash)'} "${d.subject}"`),
      archiveFolder: `${response.data.archiveFolder.accountId}:${response.data.archiveFolder.path}`,
      gmailAllMail: `${response.data.gmailAllMail.accountId}:${response.data.gmailAllMail.path}`,
    };
  }
  return response;
}

const scenarios = {
  // Automatická detekce složek (bez folderRefs)
  async detect() {
    const { send } = startBackground();
    const r = await send({ action: 'findDuplicates' });
    const ids = r.success ? r.data.duplicates.map((d) => d.gmailMessage.id) : [];
    return { response: summarize(r), ok: r.success && same(ids, EXPECTED_DUPLICATES) };
  },
  // Složky vybrané uživatelem, všechny druhy párování + stránkování Gmailu
  async refs() {
    const { send, hub } = startBackground();
    const r = await send({ action: 'findDuplicates', folderRefs: REFS });
    const ids = r.success ? r.data.duplicates.map((d) => d.gmailMessage.id) : [];
    const pages = hub.log.filter((e) => e.call === 'messages.continueList').length;
    return { response: summarize(r), extra: { continueListCalls: pages }, ok: r.success && same(ids, EXPECTED_DUPLICATES) && pages > 0 };
  },
  // Stejná cesta /Trash v lokálních složkách i Gmailu - musí se vzít lokální
  async 'refs-trash'() {
    const { send } = startBackground();
    const r = await send({ action: 'findDuplicates', folderRefs: { ...REFS, archiveFolder: { accountId: 'account1', path: '/Trash' } } });
    return { response: summarize(r), ok: r.success && r.data.duplicates.length === 0 && r.data.archiveFolder.accountId === 'account1' };
  },
  // Přesun do vybraného koše; 102 selže -> movedIds ho nesmí obsahovat
  async move() {
    const { send, hub } = startBackground({ ...hubOptions(), failMoveIds: [102] });
    const r = await send({ action: 'moveDuplicates', duplicateIds: EXPECTED_DUPLICATES, gmailTrash: TRASH });
    const trash = hub.folderContents('account2:/[Gmail]/Trash');
    return {
      response: r,
      extra: { gmailTrash: trash },
      ok: r.success && !r.stopped && same(r.movedIds, [101, 106]) && same(trash, [101, 106]),
    };
  },
  // Stop během načítání -> chyba 'Operace zastavena uživatelem'
  async 'stop-scan'() {
    const { send } = startBackground({ ...hubOptions(), pageDelayMs: 50 });
    const pending = send({ action: 'findDuplicates', folderRefs: REFS });
    await new Promise((r) => setTimeout(r, 80));
    await send({ action: 'stop' });
    const r = await pending;
    return { response: summarize(r), ok: !r.success && r.error === 'Operace zastavena uživatelem' };
  },
  // Stop během přesunu -> {stopped:true}, přesunuté jen celé dávky
  async 'stop-move'() {
    const { send } = startBackground({ ...hubOptions(), moveDelayMs: 30 });
    const ids = Array.from({ length: 250 }, (_, i) => 1000 + i);
    const pending = send({ action: 'moveDuplicates', duplicateIds: ids, gmailTrash: TRASH });
    await new Promise((r) => setTimeout(r, 50));
    await send({ action: 'stop' });
    const r = await pending;
    return {
      response: { ...r, movedIds: `${r.movedIds?.length} ids` },
      ok: r.success && r.stopped && r.movedIds.length > 0 && r.movedIds.length < 250 && r.movedIds.length % 50 === 0,
    };
  },
};

async function runBg() {
  const name = positional[0] || 'all';
  const names = name === 'all' ? Object.keys(scenarios) : [name];
  let failed = 0;
  for (const scenario of names) {
    if (!scenarios[scenario]) {
      console.error(`Neznámý scénář "${scenario}". Dostupné: ${Object.keys(scenarios).join(', ')}, all`);
      process.exit(2);
    }
    const result = await scenarios[scenario]();
    console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${scenario}`);
    console.log(JSON.stringify({ response: result.response, ...result.extra }, null, 2).replace(/^/gm, '     '));
    if (!result.ok) failed++;
  }
  console.log(failed ? `\n${failed} scénář(ů) selhalo` : `\nVšech ${names.length} scénářů prošlo`);
  process.exit(failed ? 1 : 0);
}

async function runSend() {
  const request = JSON.parse(positional[0]);
  flags.verbose = true;
  const { send, hub } = startBackground();
  const r = await send(request);
  console.log(JSON.stringify(summarize(r), null, 2));
  console.log('messages.move volání:', JSON.stringify(hub.log.filter((e) => e.call === 'messages.move')));
}

// ---------- ui: popup.html v headless Chrome přes CDP ----------
function findChrome() {
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
  }
  throw new Error('Chrome/Chromium nenalezen');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };

/**
 * popup.html s vloženým falešným messengerem a background.js ve vlastním scope
 * (funkční parametr `messenger` zastíní window.messenger, který používá popup.js)
 */
function harnessPopupHtml() {
  const html = readFileSync(join(DIST, 'popup.html'), 'utf8');
  const bgSource = readFileSync(join(DIST, 'background.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const inject = `
  <script src="/harness/fake-messenger.js"></script>
  <script>
    window.__hub = FakeMessenger.createHub(${JSON.stringify(loadFixture())}, ${JSON.stringify(hubOptions())});
    window.messenger = window.__hub.context('popup');
    // Skutečný confirm() by zablokoval CDP - automaticky potvrdíme
    window.confirm = (text) => { console.log('[confirm] ' + text); return true; };
  </script>
  <script>(function (messenger) {\n${bgSource}\n})(window.__hub.context('background'));</script>
  `;
  if (!html.includes('<script src="popup.js">')) throw new Error('popup.html neobsahuje <script src="popup.js">');
  return html.replace('<script src="popup.js">', `${inject}<script src="popup.js">`);
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      let body;
      let file = url.pathname;
      if (file === '/popup.html') body = harnessPopupHtml();
      else if (file.startsWith('/harness/')) body = readFileSync(join(SKILL_DIR, file.slice('/harness/'.length)));
      else body = readFileSync(join(DIST, file));
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (error) {
      res.writeHead(404);
      res.end(String(error));
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function launchChrome(url, width, height) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'gad-chrome-'));
  const chrome = spawn(findChrome(), [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsBrowser = await new Promise((ok, fail) => {
    let buffer = '';
    const timer = setTimeout(() => fail(new Error(`Chrome nevypsal DevTools URL:\n${buffer}`)), 15000);
    chrome.stderr.on('data', (chunk) => {
      buffer += chunk;
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); ok(match[1]); }
    });
    chrome.on('exit', (code) => fail(new Error(`Chrome skončil (${code}):\n${buffer}`)));
  });
  const port = new URL(wsBrowser).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(JSON.stringify(msg.error))) : ok(msg.result);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      console.log(`  [console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      console.log(`  [výjimka] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    }
  };
  const cdp = (method, params = {}) => new Promise((ok, fail) => {
    const id = ++nextId;
    pending.set(id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params }));
  });

  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url });

  const evaluate = async (expression) => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, label, timeoutMs = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { if (await evaluate(expression)) return; } catch { /* stránka se ještě načítá */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timeout: ${label}`);
  };
  const screenshot = async (file) => {
    const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(`  screenshot: ${file}`);
  };
  const close = async () => {
    ws.close();
    // Profil smažeme až po skončení Chrome, jinak do něj ještě zapisuje
    const exited = new Promise((ok) => chrome.once('exit', ok));
    chrome.kill();
    await exited;
    rmSync(userDataDir, { recursive: true, force: true });
  };
  return { evaluate, waitFor, screenshot, close };
}

const STATUS_JS = `({ text: document.getElementById('status').textContent.trim(), cls: document.getElementById('status').className })`;

async function runUi() {
  requireDist();
  const outDir = resolve(flags.out || '/tmp/gad-shots');
  mkdirSync(outDir, { recursive: true });
  const [width, height] = String(flags.size || '650x500').split('x').map(Number);
  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/popup.html`;
  console.log(`popup: ${url}`);
  const page = await launchChrome(url, width, height);
  try {
    // 1. Načtení složek a předvýběr
    await page.waitFor(`document.getElementById('archiveFolder')?.options.length > 1 && document.getElementById('gmailTrash').value !== ''`, 'načtení a předvýběr složek');
    const selected = await page.evaluate(`['archiveFolder','gmailAllMail','gmailTrash'].map(id => id + '=' + document.getElementById(id).value)`);
    console.log('předvybrané složky:', selected.join('  '));
    console.log('titulek:', await page.evaluate(`document.querySelector('h1').textContent`));

    if (flags.eval) {
      console.log('eval:', JSON.stringify(await page.evaluate(String(flags.eval)), null, 2));
      await page.screenshot(join(outDir, 'eval.png'));
      return;
    }
    await page.screenshot(join(outDir, '01-loaded.png'));

    // 2. Hledání duplicit (volitelně se Stop)
    await page.evaluate(`document.getElementById('scanBtn').click()`);
    if (flags.stop) {
      await page.waitFor(`document.getElementById('stopBtn').style.display !== 'none'`, 'zobrazení Stop');
      await page.evaluate(`document.getElementById('stopBtn').click()`);
      await page.waitFor(`!document.getElementById('scanBtn').disabled`, 'dokončení po Stop');
      console.log('status:', await page.evaluate(STATUS_JS));
      await page.screenshot(join(outDir, '02-stopped.png'));
      return;
    }
    await page.waitFor(`!document.getElementById('scanBtn').disabled && document.getElementById('status').className.indexOf('loading') < 0`, 'dokončení hledání', 60000);
    console.log('status:', await page.evaluate(STATUS_JS));
    const items = await page.evaluate(`[...document.querySelectorAll('.duplicate-item')].map(el => el.textContent.replace(/\\s+/g, ' ').trim())`);
    console.log(`duplicity v seznamu (${items.length}):`);
    items.forEach((item) => console.log(`  - ${item}`));
    await page.screenshot(join(outDir, '02-duplicates.png'));
    if (items.length === 0) return;

    // 3. Přesun vybraných do koše (confirm je přepsaný na true)
    await page.evaluate(`document.getElementById('moveBtn').click()`);
    await page.waitFor(`!document.getElementById('scanBtn').disabled && document.getElementById('status').className.indexOf('loading') < 0`, 'dokončení přesunu', 60000);
    console.log('status:', await page.evaluate(STATUS_JS));
    console.log('Gmail koš ve fixture:', await page.evaluate(`window.__hub.folderContents('account2:/[Gmail]/Trash')`));
    console.log('zbývající položky:', await page.evaluate(`document.querySelectorAll('.duplicate-item').length`));
    await page.screenshot(join(outDir, '03-moved.png'));
  } finally {
    await page.close();
    server.close();
  }
}

// ---------- tb: skutečný Thunderbird (headless, dočasný profil, ovládání přes RDP) ----------
//
// Thunderbird nemá IMAP server, proto se Gmail účet z fixture nahradí lokálními složkami
// "Gmail All Mail" a "Gmail Trash" v Místních složkách. Popup se otevře stejně jako z menu
// Nástroje (windows.create) a jeho výběry Gmail složek se doplní o tyto lokální náhrady.

const GMAIL_STANDINS = { '/[Gmail]/All Mail': '/Gmail All Mail', '/[Gmail]/Trash': '/Gmail Trash' };

/** Minimální klient Firefox Remote Debugging Protocol (pakety "délka:JSON" přes TCP) */
async function connectRdp(port, timeoutMs = 30000) {
  const net = await import('node:net');
  const start = Date.now();
  let socket;
  while (!socket) {
    try {
      socket = await new Promise((ok, fail) => {
        const s = net.connect(port, '127.0.0.1', () => ok(s));
        s.on('error', fail);
      });
    } catch (error) {
      if (Date.now() - start > timeoutMs) throw new Error(`RDP port ${port} neodpovídá: ${error.message}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  let buffer = Buffer.alloc(0);
  const waiters = [];
  const inbox = [];
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    for (;;) {
      const colon = buffer.indexOf(58);
      if (colon < 0) break;
      const length = Number(buffer.subarray(0, colon).toString());
      if (buffer.length < colon + 1 + length) break;
      const packet = JSON.parse(buffer.subarray(colon + 1, colon + 1 + length).toString());
      buffer = buffer.subarray(colon + 1 + length);
      const index = waiters.findIndex((w) => w.match(packet));
      if (index >= 0) waiters.splice(index, 1)[0].ok(packet);
      else inbox.push(packet);
    }
  });
  const next = (match) => new Promise((ok) => {
    const index = inbox.findIndex(match);
    if (index >= 0) ok(inbox.splice(index, 1)[0]);
    else waiters.push({ match, ok });
  });
  // Odpověď na požadavek nemá "type"; pakety s "type" jsou události
  const request = async (to, type, extra = {}) => {
    const json = JSON.stringify({ to, type, ...extra });
    socket.write(`${Buffer.byteLength(json)}:${json}`);
    const reply = await next((p) => p.from === to && !p.type);
    if (reply.error) throw new Error(`RDP ${type} -> ${reply.error}: ${reply.message}`);
    return reply;
  };
  await next((p) => p.from === 'root');

  /**
   * Vyhodnotí async JS v konzoli daného actoru a vrátí JSON výsledek.
   * evaluateJSAsync nečeká na Promise, proto výsledek ukládáme do globálu a dotazujeme se.
   */
  const evaluate = async (consoleActor, body, evalTimeoutMs = 60000) => {
    const key = `__gad${Math.random().toString(36).slice(2)}`;
    const run = async (text) => {
      const { resultID } = await request(consoleActor, 'evaluateJSAsync', { text });
      const result = await next((p) => p.type === 'evaluationResult' && p.resultID === resultID);
      if (result.exception) throw new Error(result.exceptionMessage);
      let value = result.result;
      if (value && typeof value === 'object' && value.type === 'longString') {
        value = (await request(value.actor, 'substring', { start: 0, end: value.length })).substring;
      }
      return value;
    };
    await run(`globalThis.${key} = undefined; (async () => { ${body} })().then(v => globalThis.${key} = JSON.stringify({ v: v === undefined ? null : v }), e => globalThis.${key} = JSON.stringify({ e: String(e && e.stack || e) }))`);
    const start = Date.now();
    for (;;) {
      const value = await run(`globalThis.${key}`);
      if (typeof value === 'string') {
        await run(`delete globalThis.${key}`);
        const parsed = JSON.parse(value);
        if (parsed.e) throw new Error(parsed.e);
        return parsed.v;
      }
      if (Date.now() - start > evalTimeoutMs) throw new Error(`Timeout vyhodnocení: ${body.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  return { request, next, evaluate, close: () => socket.destroy() };
}

/** RFC 2047 encoded-word pro ne-ASCII hlavičky */
function encodeHeader(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}

function encodeAuthor(author) {
  const match = author.match(/^(.*?)\s*<([^>]+)>$/);
  return match ? `${encodeHeader(match[1])} <${match[2]}>` : author;
}

/** Připraví profil: debugger prefs + Místní složky s mbox soubory podle fixture */
function seedProfile(profile, fixture) {
  const prefs = {
    'devtools.debugger.remote-enabled': true,
    'devtools.chrome.enabled': true,
    'devtools.debugger.prompt-connection': false,
    'xpinstall.signatures.required': false,
    'mail.shell.checkDefaultClient': false,
    'mailnews.start_page.enabled': false,
    'mail.accountmanager.accounts': 'account1',
    'mail.accountmanager.localfoldersserver': 'server1',
    'mail.account.account1.server': 'server1',
    'mail.server.server1.type': 'none',
    'mail.server.server1.hostname': 'Local Folders',
    'mail.server.server1.userName': 'nobody',
    'mail.server.server1.name': 'Místní složky',
    'mail.server.server1.directory-rel': '[ProfD]Mail/Local Folders',
  };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') + '\n');

  // Stejná data jako fake-messenger (včetně výplňových zpráv pro stránkování)
  const hub = createHub(fixture);
  const localAccount = fixture.accounts.find((a) => a.type === 'none');
  const byFolder = new Map();
  const collect = (folders) => (folders || []).forEach((f) => { byFolder.set(f.path, []); collect(f.subFolders); });
  collect(localAccount.folders);
  Object.values(GMAIL_STANDINS).forEach((path) => byFolder.set(path, []));
  for (const account of fixture.accounts) {
    const walk = (folders) => (folders || []).forEach((f) => {
      const target = account.type === 'none' ? f.path : GMAIL_STANDINS[f.path];
      if (target) {
        for (const id of hub.folderContents(`${account.id}:${f.path}`)) byFolder.get(target).push(id);
      }
      walk(f.subFolders);
    });
    walk(account.folders);
  }
  // Hlavičky vezmeme přímo z fixture + výplně stejným algoritmem jako fake-messenger
  const allMessages = new Map();
  for (const m of fixture.messages) allMessages.set(m.id, m);
  for (let i = 0; i < (fixture.gmailFiller || 0); i++) {
    allMessages.set(1000 + i, {
      id: 1000 + i, headerMessageId: `filler-${i}@test`, subject: `Výplňová zpráva ${i}`,
      author: 'filler@example.com', date: new Date(Date.UTC(2023, 0, 1) + i * 3600e3).toISOString(),
    });
  }

  const root = join(profile, 'Mail', 'Local Folders');
  const expected = {};
  for (const [path, ids] of byFolder) {
    const file = join(root, path.slice(1).split('/').map((part, i, arr) => (i < arr.length - 1 ? `${part}.sbd` : part)).join('/'));
    mkdirSync(dirname(file), { recursive: true });
    const mbox = ids.map((id) => {
      const m = allMessages.get(id);
      const headers = [
        m.headerMessageId ? `Message-ID: <${m.headerMessageId}>` : null,
        `From: ${encodeAuthor(m.author)}`,
        `Subject: ${encodeHeader(m.subject)}`,
        `Date: ${new Date(m.date).toUTCString()}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        `X-GAD-Fixture-Id: ${id}`,
      ].filter(Boolean);
      return `From - ${new Date(m.date).toUTCString()}\n${headers.join('\n')}\n\nTestovací zpráva ${id}\n\n`;
    }).join('');
    writeFileSync(file, mbox);
    expected[path] = ids.length;
  }
  return expected;
}

async function runTb() {
  requireDist();
  const outDir = resolve(flags.out || '/tmp/gad-shots');
  mkdirSync(outDir, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'gad-tb-profile-'));
  // Pojistka: nikdy nepouštět nad skutečným profilem uživatele
  if (resolve(profile).startsWith(join(homedir(), '.thunderbird'))) throw new Error(`Odmítám profil ${profile}`);
  const fixture = loadFixture();
  const expected = seedProfile(profile, fixture);
  console.log(`profil: ${profile}`);

  const port = 6100 + Math.floor(Math.random() * 800);
  const tb = spawn('thunderbird', ['-profile', profile, '-no-remote', '-new-instance', '-start-debugger-server', String(port)], {
    env: { ...process.env, MOZ_HEADLESS: '1' },
    stdio: ['ignore', 'ignore', flags.verbose ? 'inherit' : 'ignore'],
    detached: true,
  });
  let failed = 0;
  const check = (ok, label) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`); if (!ok) failed++; };

  const rdp = await connectRdp(port);
  try {
    const { addonsActor } = await rdp.request('root', 'getRoot');
    const installed = await rdp.request(addonsActor, 'installTemporaryAddon', { addonPath: DIST });
    check(installed.addon?.id === 'gmail-deduplicator@example.com', `doplněk nainstalován (${installed.addon?.id})`);

    // Konzole background stránky doplňku (TB 153: descriptor -> getWatcher -> watchTargets)
    const { addons } = await rdp.request('root', 'listAddons');
    const descriptor = addons.find((a) => a.id === installed.addon.id);
    const watcher = await rdp.request(descriptor.actor, 'getWatcher', { isServerTargetSwitchingEnabled: true });
    const bgTarget = rdp.next((p) => p.type === 'target-available-form' && String(p.target.url).startsWith('moz-extension://'));
    await rdp.request(watcher.actor || watcher.from, 'watchTargets', { targetType: 'frame' });
    const bg = (await bgTarget).target.consoleActor;

    // Privilegovaná konzole hlavního procesu (reparse mboxů, screenshoty oken)
    const { processDescriptor } = await rdp.request('root', 'getProcess', { id: 0 });
    const chrome = (await rdp.request(processDescriptor.actor, 'getTarget')).process.consoleActor;

    // mbox bez .msf Thunderbird nezaindexuje, dokud se složka neotevře -> vynutíme
    const counts = await rdp.evaluate(chrome, `
      const root = MailServices.accounts.localFoldersServer.rootFolder;
      for (const f of root.descendants) f.updateFolder(null);
      for (let i = 0; i < 100; i++) {
        const counts = Object.fromEntries(root.descendants.map(f => ['/' + f.URI.split('/').slice(3).map(decodeURIComponent).join('/'), f.getTotalMessages(false)]));
        if (${JSON.stringify(Object.entries(expected))}.every(([p, n]) => counts[p] === n)) return counts;
        await new Promise(r => setTimeout(r, 200));
      }
      return 'timeout ' + JSON.stringify(Object.fromEntries(root.descendants.map(f => [f.URI, f.getTotalMessages(false)])));`);
    check(typeof counts === 'object', `mbox složky zaindexovány ${JSON.stringify(counts)}`);

    const screenshot = async (titlePart, name) => {
      const dataUrl = await rdp.evaluate(chrome, `
        const w = [...Services.wm.getEnumerator(null)].find(w => w.document.title.includes(${JSON.stringify(titlePart)}));
        if (!w) return null;
        const bitmap = await w.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, 'white');
        const canvas = w.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        return canvas.toDataURL('image/png');`);
      if (!dataUrl) { console.log(`  screenshot: okno "${titlePart}" nenalezeno`); return; }
      const file = join(outDir, name);
      writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`  screenshot: ${file}`);
    };
    await screenshot('Thunderbird', 'tb-00-main.png');

    // Popup otevřeme stejně jako položka v menu Nástroje
    await rdp.evaluate(bg, `await messenger.windows.create({ url: 'popup.html', type: 'popup', width: 650, height: 500 });`);
    const POPUP = `const view = messenger.extension.getViews().find(v => v.location.pathname.endsWith('/popup.html'));
      if (!view) throw new Error('popup view nenalezen');
      const $ = (id) => view.document.getElementById(id);`;
    const waitPopup = (condition, label) => rdp.evaluate(bg, `
      for (let i = 0; i < 300; i++) {
        const view = messenger.extension.getViews().find(v => v.location.pathname.endsWith('/popup.html'));
        if (view && view.document.readyState === 'complete') {
          const $ = (id) => view.document.getElementById(id);
          if (${condition}) return true;
        }
        await new Promise(r => setTimeout(r, 200));
      }
      throw new Error('Timeout: ${label}');`);
    const popupState = () => rdp.evaluate(bg, `${POPUP}
      return { status: $('status').textContent.trim(), cls: $('status').className,
               items: [...view.document.querySelectorAll('.duplicate-item')].map(el => el.textContent.replace(/\\s+/g, ' ').trim()),
               subjects: [...view.document.querySelectorAll('.duplicate-subject')].map(el => el.textContent) };`);

    await waitPopup(`$('archiveFolder').options.length > 1`, 'načtení složek v popupu');
    // Gmail výběry: bez IMAP účtu jsou prázdné -> doplníme lokální náhrady se stejným data-folder-data
    const selection = await rdp.evaluate(bg, `${POPUP}
      const local = [...$('archiveFolder').options].filter(o => o.value);
      const add = (select, path) => {
        const source = local.find(o => JSON.parse(o.dataset.folderData).path === path);
        const option = source.cloneNode(true);
        option.textContent = '(náhrada Gmailu) ' + source.textContent;
        select.appendChild(option);
        select.value = option.value;
      };
      add($('gmailAllMail'), ${JSON.stringify(GMAIL_STANDINS['/[Gmail]/All Mail'])});
      add($('gmailTrash'), ${JSON.stringify(GMAIL_STANDINS['/[Gmail]/Trash'])});
      // Skutečný confirm() otevře modální dialog a zablokuje ovládání
      view.confirm = (text) => { console.log('[confirm] ' + text); return true; };
      return ['archiveFolder', 'gmailAllMail', 'gmailTrash'].map(id => id + '=' + $(id).value);`);
    console.log('vybrané složky:', selection.join('  '));
    await screenshot('Gmail Archive Deduplicator', 'tb-01-loaded.png');

    await rdp.evaluate(bg, `${POPUP} $('scanBtn').click();`);
    await waitPopup(`!$('scanBtn').disabled && !$('status').className.includes('loading')`, 'dokončení hledání');
    const scan = await popupState();
    console.log('status:', scan.status);
    scan.items.forEach((item) => console.log(`  - ${item}`));
    check(scan.cls.includes('success') && scan.items.length > 0, `hledání našlo ${scan.items.length} duplicit`);
    // Stejná data přes fake-messenger musí dát stejné duplicity (jinak fake neodpovídá skutečnému TB)
    const fake = await startBackground({}).send({ action: 'findDuplicates', folderRefs: REFS });
    const fakeSubjects = fake.data.duplicates.map((d) => d.subject).sort();
    check(JSON.stringify(fakeSubjects) === JSON.stringify([...scan.subjects].sort()), `shoda s fake-messenger (${fakeSubjects.join(', ')})`);
    // Co skutečný TB vrací v MessageHeader (fake-messenger vrací hodnoty z fixture beze změny)
    const headers = await rdp.evaluate(bg, `
      const account = (await messenger.accounts.list(true)).find(a => a.type === 'none');
      const folder = account.folders.find(f => f.path === '/Archives');
      return (await messenger.messages.list(folder)).messages.map(m => [m.subject, m.headerMessageId, m.author, m.date]);`);
    console.log('MessageHeader v /Archives (subject | headerMessageId | author | date):');
    headers.forEach((h) => console.log(`  ${h.join(' | ')}`));
    await screenshot('Gmail Archive Deduplicator', 'tb-02-duplicates.png');

    if (scan.items.length > 0) {
      await rdp.evaluate(bg, `${POPUP} $('moveBtn').click();`);
      await waitPopup(`!$('scanBtn').disabled && !$('status').className.includes('loading')`, 'dokončení přesunu');
      const moved = await popupState();
      console.log('status:', moved.status);
      const trash = await rdp.evaluate(bg, `
        const account = (await messenger.accounts.list(true)).find(a => a.type === 'none');
        const folder = account.folders.find(f => f.path === ${JSON.stringify(GMAIL_STANDINS['/[Gmail]/Trash'])});
        return (await messenger.messages.list(folder)).messages.map(m => m.subject);`);
      console.log('Gmail Trash (náhrada) obsahuje:', trash);
      check(moved.cls.includes('success') && trash.length === scan.items.length, 'přesun do koše');
      await screenshot('Gmail Archive Deduplicator', 'tb-03-moved.png');
    }
  } finally {
    rdp.close();
    try { process.kill(-tb.pid, 'SIGTERM'); } catch { /* už neběží */ }
    await new Promise((r) => setTimeout(r, 2000));
    spawnSync('pkill', ['-f', profile]);
    if (!flags['keep-profile']) rmSync(profile, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

// ---------- main ----------
const commands = { bg: runBg, send: runSend, ui: runUi, tb: runTb };
if (!commands[command]) {
  console.error('Použití: driver.mjs <bg [scénář|all] | send \'<json>\' | ui | tb> [volby] (viz hlavička souboru)');
  process.exit(2);
}
commands[command]().catch((error) => {
  console.error(error);
  process.exit(1);
});
