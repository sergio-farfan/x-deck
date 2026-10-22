// End-to-end test: loads the unpacked extension in Playwright's Chromium and
// serves X-like pages at https://x.com/* from a local HTTPS server (x.com is
// mapped to it with --host-resolver-rules, so responses go through Chrome's
// real network stack and the extension's header rule; real X answers headless
// browsers with HTTP 403). Responses carry logged-in X's framing headers:
// X-Frame-Options DENY and a nonce-based CSP with frame-ancestors 'none'.
// Phase 1: the deck shell takes over https://x.com/i/xdeck before X's scripts
//   run, columns embed same-origin, and SameSite=Lax cookies reach them.
// Phase 2: filters, clean mode, home tab, collect button, unread badge,
//   reading pane, layouts, dialogs, inbox, persistence.
// Run: npm run test:e2e   (HEADED=1 to watch). Screenshots go to tests/out/.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests', 'out');
fs.mkdirSync(outDir, { recursive: true });
const scratch = path.join(os.homedir(), 'tmp');
fs.mkdirSync(scratch, { recursive: true });
const userDataDir = fs.mkdtempSync(path.join(scratch, 'xdeck-e2e-'));
const fixture = fs.readFileSync(path.join(root, 'tests/fixtures/x-timeline.html'), 'utf8');
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'nonce-xdtest' 'unsafe-inline' https://*.twimg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.twimg.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.x.com",
  "frame-src 'self' https://x.com",
  "frame-ancestors 'self' https://x.com https://twitter.com",
  "object-src 'none'",
].join('; ');
// Logged-in X refuses framing outright (seen in a real session: "x.com refused
// to connect"), so the fixture does too.
const X_HEADERS = { 'x-frame-options': 'DENY', 'content-security-policy': CSP.replace(/frame-ancestors[^;]*/, "frame-ancestors 'none'") };
// Stand-in for X's app shell: if these scripts ran, X would own the deck page.
const SHELL = '<!doctype html><html dir="ltr" lang="en" style="font-size:15px"><head>'
  + '<link rel="stylesheet" href="https://x.com/x-app.css">'
  + '<style>body{background:rgb(255,0,0)}</style>'
  + '<script nonce="xdtest">document.documentElement.setAttribute("data-xapp","ran")</script>'
  + '<script nonce="xdtest" src="https://x.com/x-app.js"></script></head>'
  + '<body><div id="react-root"></div><script nonce="xdtest">document.body.insertAdjacentHTML("beforeend","<p id=xapp>X APP RAN</p>")</script>'
  + '<script nonce="xdtest" defer src="https://x.com/x-app.js"></script></body></html>';
const requests = [];
let timeline = fixture; // what the route serves for column pages; tests swap in variants
const FRESH_CELL = '<div data-testid="cellInnerDiv"><div><article data-testid="tweet" role="article">'
  + '<div data-testid="User-Name"><a href="/zed"><span>Zed</span></a><a href="/zed"><span>@zed</span></a>'
  + '<a href="/zed/status/2001"><time datetime="2026-10-21T13:00:00.000Z">1m</time></a></div>'
  + '<div data-testid="tweetText" lang="en">Fresh after reload</div>'
  + '<div role="group" aria-label="0 replies, 0 reposts, 1 like"><button data-testid="like">1</button></div></article></div></div>';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 15000, step = 200) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch { /* retry */ }
    await sleep(step);
  }
  return last;
}

// Local stand-in for x.com (self-signed certificate, generated per run).
const certDir = fs.mkdtempSync(path.join(scratch, 'xdeck-cert-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem'),
  '-subj', '/CN=x.com', '-addext', 'subjectAltName=DNS:x.com,DNS:twitter.com'], { stdio: 'ignore' });
const server = https.createServer({
  key: fs.readFileSync(path.join(certDir, 'key.pem')),
  cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
}, (req, res) => {
  const url = new URL(req.url, 'https://x.com');
  requests.push({ path: url.pathname, dest: req.headers['sec-fetch-dest'] || '', cookie: req.headers.cookie || '' });
  if (url.pathname === '/setcookie') {
    res.writeHead(200, { 'content-type': 'text/html', ...X_HEADERS, 'set-cookie': 'ct0=testcsrf; Domain=.x.com; Path=/; Secure; SameSite=Lax' });
    return res.end('<p>ok</p>');
  }
  if (url.pathname === '/x-app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('document.documentElement.setAttribute("data-xext","ran");'); }
  if (url.pathname === '/x-app.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end('html{outline:9px solid rgb(0,255,0)}'); }
  if (url.pathname === '/favicon.ico') { res.writeHead(404); return res.end(); }
  // Like the logged-in session: these two never load inside frames, even with
  // the extension's header rule; the frame ends on Chrome's error page.
  if ((url.pathname === '/home' || url.pathname === '/notifications') && req.headers['sec-fetch-dest'] === 'iframe') {
    req.socket.destroy();
    return undefined;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...X_HEADERS });
  res.end(url.pathname.startsWith('/i/xdeck') ? SHELL : timeline);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  viewport: { width: 1600, height: 900 },
  ignoreHTTPSErrors: true,
  args: [
    `--disable-extensions-except=${root}`,
    `--load-extension=${root}`,
    `--host-resolver-rules=MAP x.com 127.0.0.1:${port},MAP twitter.com 127.0.0.1:${port}`,
  ],
});

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
const extId = sw.url().split('/')[2];
const deckUrl = 'https://x.com/i/xdeck';
console.log(`extension id ${extId}`);

const deckErrors = [];
function watchErrors(page) {
  page.on('pageerror', (err) => deckErrors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location().url || '';
    if (where.startsWith('chrome-extension://') || /XDeck|Content Security Policy|Refused to/i.test(msg.text())) deckErrors.push(`console: ${msg.text()}`);
  });
}

const col = (type, params, extra = {}) => ({
  id: `c_${Math.random().toString(36).slice(2, 8)}`, type, params, title: '', width: 'medium',
  refreshSec: 0, refreshMode: 'soft', notify: false, filters: {}, ...extra,
});

async function seed(data) {
  await sw.evaluate(async (d) => { await chrome.storage.local.clear(); await chrome.storage.local.set(d); }, data);
}

try {
  // ------------------------------------------------------------------
  // Phase 1: deck shell, same-origin columns, first-party cookies
  // ------------------------------------------------------------------
  const setter = await context.newPage();
  await setter.goto('https://x.com/setcookie');
  await setter.close();
  await seed({
    settings: { lazyLoad: false },
    workspaces: [{ id: 'w1', name: 'Shell', layout: 'columns', gridRows: 2, columns: [col('home', { homeTab: 'following' })] }],
    activeWorkspaceId: 'w1',
  });
  const shell = await context.newPage();
  watchErrors(shell);
  await shell.goto(deckUrl, { waitUntil: 'commit' });
  await shell.waitForSelector('.rail .rail-btn', { timeout: 15000 }).catch(() => {});
  const takeover = await shell.evaluate(() => ({
    xapp: document.documentElement.getAttribute('data-xapp'),
    xext: document.documentElement.getAttribute('data-xext'),
    xappText: !!document.getElementById('xapp'),
    bg: getComputedStyle(document.body).backgroundColor,
    outline: getComputedStyle(document.documentElement).outlineStyle,
    rail: document.querySelectorAll('.rail .rail-btn').length,
    title: document.title,
    painted: null,
  }));
  takeover.painted = await shell.evaluate(() => new Promise((resolve) => {
    let done = false;
    requestAnimationFrame(() => { if (!done) { done = true; resolve(true); } });
    setTimeout(() => { if (!done) { done = true; resolve(false); } }, 3000);
  }));
  check('shell: deck renders at https://x.com/i/xdeck', takeover.rail > 0 && takeover.title === 'XDeck', JSON.stringify(takeover));
  check("shell: X's inline and external scripts never ran", takeover.xapp !== 'ran' && takeover.xext !== 'ran' && !takeover.xappText, JSON.stringify(takeover));
  check("shell: X's styles removed", takeover.bg !== 'rgb(255, 0, 0)' && takeover.outline !== 'solid', `${takeover.bg} / ${takeover.outline}`);
  check('shell: page renders (animation frames run)', takeover.painted === true);
  const shellFrame = await waitFor(async () => {
    const hnd = await shell.locator('.col iframe').first().elementHandle();
    return hnd && hnd.contentFrame();
  });
  const embedded = shellFrame && await waitFor(() => shellFrame.evaluate(() => document.documentElement.classList.contains('xdeck-frame')));
  check('frames: columns load although X sends X-Frame-Options DENY and frame-ancestors none', embedded, shellFrame ? shellFrame.url() : 'no frame');
  const reachedHome = shellFrame && await waitFor(() => shellFrame.url() === 'https://x.com/home', 15000);
  check('refused pages: Home column reaches /home through the boot page', reachedHome, shellFrame ? shellFrame.url() : 'no frame');
  const remembered = await sw.evaluate(() => chrome.storage.local.get('xdeckBootPaths'));
  check('refused pages: refused path remembered for next time', (remembered.xdeckBootPaths || []).includes('/home'), JSON.stringify(remembered));
  check('refused pages: no error placeholder in the column', await shell.locator('.col').first().locator('.col-error').count() === 0);
  const frameCookie = shellFrame ? await shellFrame.evaluate(() => document.cookie) : '';
  check('cookies: SameSite=Lax CSRF cookie readable in the column', /ct0=testcsrf/.test(frameCookie), frameCookie);
  const homeReq = requests.find((r) => r.path === '/home' && r.dest === 'iframe');
  check('cookies: SameSite=Lax cookie sent with the column request', homeReq && /ct0=testcsrf/.test(homeReq.cookie), homeReq ? homeReq.cookie : 'no request');
  const rules = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
  const rule = rules.find((r) => r.id === 1);
  check('security: header rule is scoped to the deck tab and to x.com-initiated frames',
    rules.length === 1 && rule && rule.condition.tabIds.length === 1 && rule.condition.initiatorDomains.includes('x.com'),
    JSON.stringify(rule && rule.condition));
  await shell.screenshot({ path: path.join(outDir, '1-shell.png') });

  // A normal x.com tab keeps X's protection: its x.com iframes stay blocked.
  const normal = await context.newPage();
  await normal.goto('https://x.com/explore', { waitUntil: 'domcontentloaded' });
  await normal.evaluate(() => { const f = document.createElement('iframe'); f.src = 'https://x.com/home'; document.body.appendChild(f); });
  await sleep(3000);
  const normalChild = normal.frames().find((f) => f !== normal.mainFrame());
  let normalFramed = false;
  try { normalFramed = await normalChild.evaluate(() => !!document.querySelector('[data-testid="cellInnerDiv"]')); } catch { normalFramed = false; }
  check('security: x.com stays unframeable in normal tabs', !normalFramed, normalChild ? normalChild.url() : 'no frame');
  await normal.close();
  await shell.close();
  const rulesAfter = await waitFor(async () => {
    const r = await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules());
    return r.length === 0 ? r : null;
  }, 5000);
  check('security: header rule removed when the deck tab closes', Array.isArray(rulesAfter), JSON.stringify(rulesAfter));

  // ------------------------------------------------------------------
  // Phase 2: features on the fixture
  // ------------------------------------------------------------------
  const home = col('home', { homeTab: 'following' }, { title: 'Home', notify: true, filters: { exclude: 'spoiler' } });
  await seed({
    settings: { lazyLoad: false, readingPane: false },
    workspaces: [
      { id: 'w1', name: 'Test', layout: 'columns', gridRows: 2, columns: [home] },
      { id: 'w2', name: 'Second', layout: 'grid', gridRows: 1, columns: [] },
    ],
    activeWorkspaceId: 'w1',
  });
  const page = await context.newPage();
  watchErrors(page);
  await page.goto(deckUrl, { waitUntil: 'commit' });
  await page.waitForSelector('.col');
  const frameFor = async (colIndex) => {
    const handle = await page.locator('.col iframe').nth(colIndex).elementHandle();
    return handle && handle.contentFrame();
  };
  const f1 = await waitFor(() => frameFor(0));
  await waitFor(() => f1.evaluate(() => document.documentElement.classList.contains('xdeck-frame')));
  await waitFor(() => f1.evaluate(() => location.pathname === '/home'), 15000);
  await sleep(1200);

  const state1 = await f1.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
    return {
      hide: cells.map((c) => c.getAttribute('data-xd-hide')),
      kind: cells.map((c) => c.getAttribute('data-xd-kind')),
      collectButtons: document.querySelectorAll('.xd-collect').length,
      following: document.getElementById('tab-following').getAttribute('aria-selected'),
      navHidden: getComputedStyle(document.querySelector('header[role="banner"]')).display,
      sidebarHidden: getComputedStyle(document.querySelector('[data-testid="sidebarColumn"]')).display,
      repostVisible: getComputedStyle(cells[1].firstElementChild).display,
    };
  });
  check('filter: post with excluded word is hidden', state1.hide[1] === 'excluded word', JSON.stringify(state1.hide));
  check('filter: other posts stay visible', state1.hide[0] === null && state1.hide[3] === null);
  check('filter: hidden cell content not displayed', state1.repostVisible === 'none');
  check('clean: promoted post marked', state1.kind[2] === 'promoted', JSON.stringify(state1.kind));
  check('clean: "Who to follow" heading, users and "Show more" marked', state1.kind.slice(4, 8).every((k) => k === 'wtf'), JSON.stringify(state1.kind.slice(4)));
  check('home: switched to Following tab', state1.following === 'true');
  check('compact: X nav and sidebar hidden', state1.navHidden === 'none' && state1.sidebarHidden === 'none');
  check('collect: button injected into each post action bar', state1.collectButtons === 3, String(state1.collectButtons));

  // Unread + alert: a newer post appears after the column has armed.
  await page.mouse.move(800, 20);
  await sleep(4500);
  await f1.evaluate(() => {
    const tl = document.getElementById('timeline');
    const cell = tl.firstElementChild.cloneNode(true);
    const a = cell.querySelector('a[href="/bob/status/1001"]');
    a.setAttribute('href', '/bob/status/1009');
    cell.querySelector('time').setAttribute('datetime', '2026-10-21T12:00:00.000Z');
    cell.querySelector('[data-testid="tweetText"]').textContent = 'Brand new post';
    cell.querySelectorAll('.xd-collect').forEach((b) => b.remove());
    tl.prepend(cell);
  });
  const badge = await waitFor(() => page.locator('.col').first().locator('.badge:not([hidden])').textContent(), 6000);
  check('unread: column badge counts the new post', badge === '1', String(badge));
  const alerted = await waitFor(async () => {
    const toastShown = await page.locator('.toast', { hasText: 'new post' }).count();
    const notes = await sw.evaluate(() => new Promise((r) => chrome.notifications.getAll(r)));
    return toastShown > 0 || Object.keys(notes).length > 0;
  }, 5000);
  check('alert: new post raised a toast or desktop notification', alerted);
  const wsBadge = await page.locator('.ws-badge:not([hidden])').first().textContent().catch(() => '');
  check('unread: workspace tab shows the total', wsBadge === '1', wsBadge);
  await page.locator('.col').first().locator('.badge').click();
  check('unread: clicking the badge marks the column read', await page.locator('.col').first().locator('.badge').isHidden());

  // Collect a post, then see it in the Collections drawer.
  await f1.locator('article').nth(1).locator('.xd-collect').click();
  const saved = await waitFor(async () => (await sw.evaluate(() => chrome.storage.local.get('collections'))).collections, 5000);
  check('collect: post saved to collections', saved && saved.length === 1 && saved[0].id === '1001', saved ? saved.map((s) => s.id).join(',') : 'none');
  check('collect: button shows saved state', await f1.locator('article').nth(1).locator('.xd-collect.on').count() === 1);
  await page.locator('.rail-btn[aria-label^="Collections"]').click();
  await page.waitForSelector('.coll-item');
  check('collections: drawer lists the saved post', (await page.locator('.coll-item .coll-text').first().textContent()).includes('Hello world'));
  await page.locator('.tag-input').first().fill('launch');
  await page.locator('.tag-input').first().press('Enter');
  await waitFor(() => page.locator('.coll-item .tag', { hasText: '#launch' }).count(), 4000);
  check('collections: tag added', await page.locator('.coll-item .tag', { hasText: '#launch' }).count() === 1);
  await page.screenshot({ path: path.join(outDir, '2-collections.png') });
  await page.keyboard.press('Escape');

  // Reading pane: clicking a post opens it on the right.
  await page.locator('.topbar .icon-btn[aria-label^="Reading pane"]').click();
  await sleep(300);
  await f1.locator('article').nth(1).locator('[data-testid="tweetText"]').first().click();
  const readerSrc = await waitFor(() => page.locator('#reader iframe').getAttribute('src'), 5000);
  check('reading pane: opens the clicked post', readerSrc === 'https://x.com/bob/status/1001', String(readerSrc));
  check('reading pane: column itself did not navigate', (await f1.evaluate(() => location.pathname)) === '/home');
  await page.screenshot({ path: path.join(outDir, '3-reading-pane.png') });
  await page.locator('#reader .icon-btn[aria-label="Close reading pane"]').click();

  // Quick search adds a column; edit it to hide reposts and duplicates.
  await page.locator('.qsearch-input').fill('launch');
  await page.locator('.qsearch-input').press('Enter');
  await waitFor(() => page.locator('.col').count().then((n) => n === 2));
  const searchSrc = await page.locator('.col iframe').nth(1).getAttribute('src');
  check('search: quick search adds a Latest search column', searchSrc === 'https://x.com/search?q=launch&src=typed_query&f=live', String(searchSrc));
  const f2 = await waitFor(() => frameFor(1));
  const latestSelected = await waitFor(() => f2.evaluate(() => document.querySelector('#search-tabs [data-f="live"]') && document.querySelector('#search-tabs [data-f="live"]').getAttribute('aria-selected') === 'true'), 10000);
  check('search tab: column switches to Latest when X opens on Top', latestSelected);
  await waitFor(() => f2.evaluate(() => document.querySelectorAll('[data-xd-kind="promoted"]').length > 0));
  await sleep(800);
  await page.locator('.col').nth(1).locator('.icon-btn[aria-label="Edit column and filters"]').click();
  await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] details.filters summary').click();
  await page.locator('dialog[open] label.check', { hasText: 'Hide reposts' }).click();
  await page.locator('dialog[open] label.check', { hasText: 'already shown in another column' }).click();
  await page.screenshot({ path: path.join(outDir, '4-column-editor.png') });
  await page.locator('dialog[open] .btn-primary').click();
  const hide2 = await waitFor(async () => {
    const h = await f2.evaluate(() => [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].map((c) => c.getAttribute('data-xd-hide')));
    return h.filter(Boolean).length >= 3 ? h : null;
  }, 6000);
  check('dedupe: posts first shown in Home are hidden in the search column', hide2 && hide2.includes('shown in another column'), JSON.stringify(hide2));
  check('filter: edited filters apply live (repost hidden)', hide2 && hide2.includes('repost'), JSON.stringify(hide2));

  // Layouts.
  await f1.evaluate(() => { window.__xdMarker = 42; });
  await page.locator('.seg button', { hasText: 'Grid' }).click();
  check('layout: grid', await page.locator('.ws:not([hidden]) .ws-cols.l-grid').count() === 1);
  await page.screenshot({ path: path.join(outDir, '5-grid.png') });
  await page.locator('.seg button', { hasText: 'Tabs' }).click();
  check('layout: tabs shows a tab strip and one column', await page.locator('.ws:not([hidden]) .ws-tabs:not([hidden]) .col-tab').count() === 2 && await page.locator('.col.active').count() === 1);
  await page.screenshot({ path: path.join(outDir, '6-tabs.png') });
  await page.locator('.seg button', { hasText: 'Columns' }).click();
  check('layout: columns', await page.locator('.ws:not([hidden]) .ws-cols.l-columns').count() === 1);
  check('layout: switching did not reload frames', (await f1.evaluate(() => window.__xdMarker)) === 42);

  // Add column dialog: validation, then a profile column.
  await page.locator('.rail-btn[aria-label^="Add column"]').click();
  await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] .type-card', { hasText: 'List' }).click();
  await page.locator('dialog[open] .btn-primary').click();
  check('editor: validation error for empty list', await page.locator('dialog[open] .form-error:not([hidden])').count() === 1);
  await page.locator('dialog[open] .type-card', { hasText: 'Profile' }).click();
  await page.locator('dialog[open] .source input').fill('@nasa');
  await page.screenshot({ path: path.join(outDir, '7-add-column.png') });
  await page.locator('dialog[open] .btn-primary').click();
  await waitFor(() => page.locator('.col').count().then((n) => n === 3));
  check('editor: profile column added', (await page.locator('.col iframe').nth(2).getAttribute('src')) === 'https://x.com/nasa');

  // Inbox (what the context menus write).
  await sw.evaluate(() => chrome.storage.local.set({ 'inbox:test-1': { action: 'addColumn', url: 'https://x.com/i/lists/1234567', at: Date.now() } }));
  await waitFor(() => page.locator('.col').count().then((n) => n === 4), 5000);
  check('inbox: context-menu style "add column" works', (await page.locator('.col iframe').nth(3).getAttribute('src')) === 'https://x.com/i/lists/1234567');
  check('inbox: item removed from storage once handled', !(await sw.evaluate(() => chrome.storage.local.get('inbox:test-1')))['inbox:test-1']);

  // Alt shortcuts must not fire while typing (Option+letter types characters on macOS).
  await page.locator('.qsearch-input').focus();
  await page.keyboard.press('Alt+KeyN');
  check('keys: Alt shortcuts ignored while typing in a field', await page.locator('#composer').isHidden());
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+KeyN');
  check('keys: Alt+N opens the composer', await waitFor(() => page.locator('#composer').isVisible(), 3000));
  const composeFrame = await waitFor(async () => {
    const hnd = await page.locator('#composer iframe').elementHandle();
    const fr = hnd && await hnd.contentFrame();
    return fr && (await fr.evaluate(() => location.pathname)) === '/compose/post' ? fr : null;
  });
  await composeFrame.evaluate(() => { window.__draft = 7; });
  await page.keyboard.press('Alt+KeyN');
  await sleep(500);
  check('composer: Alt+N again keeps the open draft', (await composeFrame.evaluate(() => window.__draft)) === 7);
  await page.locator('#composer .icon-btn[aria-label="Close"]').click();

  // Remove with undo.
  await page.locator('.col').nth(3).locator('.icon-btn[aria-label="More"]').click();
  await page.locator('.menu-item', { hasText: 'Remove column' }).click();
  check('column: removed', await page.locator('.col').count() === 3);
  await page.locator('.toast-action', { hasText: 'Undo' }).click();
  await waitFor(() => page.locator('.col').count().then((n) => n === 4), 3000);
  check('column: undo restores it', await page.locator('.col').count() === 4);

  // Settings, help, workspaces, persistence.
  await page.locator('.rail-btn[aria-label="Settings"]').click();
  await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] select').first().selectOption('light');
  check('settings: theme applies live', await page.evaluate(() => document.documentElement.dataset.theme) === 'light');
  await page.screenshot({ path: path.join(outDir, '8-settings.png') });
  await page.locator('dialog[open] select').first().selectOption('dark');
  await page.locator('dialog[open] .btn-primary', { hasText: 'Done' }).click();
  await page.keyboard.press('?');
  check('help: ? opens shortcuts', await page.locator('dialog[open] .keys').count() === 1);
  await page.keyboard.press('Escape');
  await page.locator('.ws-tab', { hasText: 'Second' }).click();
  check('workspace: switching shows the empty state', await page.locator('.ws:not([hidden]) .empty:not([hidden])').count() === 1);
  await page.locator('.ws-tab', { hasText: 'Test' }).click();
  await waitFor(() => page.locator('.ws:not([hidden]) .col').count().then((n) => n === 4));
  check('workspace: switching back restores columns', await page.locator('.ws:not([hidden]) .col').count() === 4);
  await sleep(600);
  const stored = await sw.evaluate(() => chrome.storage.local.get(['workspaces']));
  const w1 = stored.workspaces.find((w) => w.id === 'w1');
  check('persistence: workspaces saved to storage', w1 && w1.columns.length === 4 && w1.columns[1].filters.dedupe === true);
  await page.screenshot({ path: path.join(outDir, '9-columns.png') });

  // Back stays inside the column.
  const fBack = await waitFor(() => frameFor(0));
  await waitFor(() => fBack.evaluate(() => document.documentElement.classList.contains('xdeck-frame')));
  await fBack.evaluate(() => history.pushState({}, '', '/bob/status/1001'));
  const backShown = await waitFor(() => page.locator('.col').first().locator('.col-back').isVisible(), 4000);
  check('back: column shows Back after navigating inside it', backShown);
  await page.locator('.col').first().locator('.col-back').click();
  const backPath = await waitFor(async () => ((await fBack.evaluate(() => location.pathname)) === '/home' ? '/home' : null), 5000);
  check('back: returns the column to its start page', backPath === '/home');
  await sleep(3000); // let the SPA fallback settle

  // Reload-mode columns still detect new posts after the page reloads.
  const homeCol = page.locator('.col').first();
  await homeCol.locator('.icon-btn[aria-label="Edit column and filters"]').click();
  await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] select').filter({ has: page.locator('option[value="reload"]') }).selectOption('reload');
  await page.locator('dialog[open] .btn-primary').click();
  if (await homeCol.locator('.badge').isVisible()) await homeCol.locator('.badge').click();
  await page.mouse.move(800, 20);
  await sleep(1500);
  timeline = fixture.replace('<div id="timeline">', `<div id="timeline">${FRESH_CELL}`);
  await homeCol.locator('.icon-btn[aria-label="More"]').click();
  await page.locator('.menu-item', { hasText: 'Reload column' }).click();
  const reloadBadge = await waitFor(() => homeCol.locator('.badge:not([hidden])').textContent(), 8000);
  check('reload mode: new post after a column reload is counted as unread', reloadBadge === '1', String(reloadBadge));
  timeline = fixture;

  // Reload-mode Refresh button: the frame asks the deck, which reloads through the loader.
  await homeCol.locator('.badge').click().catch(() => {});
  await fBack.evaluate(() => { window.__beforeReload = 1; });
  await homeCol.locator('.icon-btn[aria-label="Refresh"]').click();
  const reloadedViaButton = await waitFor(async () => (await fBack.evaluate(() => window.__beforeReload === undefined && location.pathname === '/home')) || null, 15000);
  check('refresh button (reload mode): column ends on /home, not an error page', reloadedViaButton && await homeCol.locator('.col-error').count() === 0);

  // X reloading the page itself (hard load of /home) heals through the boot page.
  await waitFor(() => fBack.evaluate(() => document.documentElement.classList.contains('xdeck-frame')), 5000);
  await fBack.evaluate(() => { window.__beforeRaw = 1; setTimeout(() => location.reload(), 0); });
  const healed = await waitFor(async () => (await fBack.evaluate(() => window.__beforeRaw === undefined && location.pathname === '/home')) || null, 15000);
  check('raw location.reload() of a refused page heals via the boot page', healed && await homeCol.locator('.col-error').count() === 0);

  // Only one live deck: a second deck tab pauses the first.
  const second = await context.newPage();
  await second.goto(deckUrl, { waitUntil: 'commit' });
  await second.waitForSelector('.col', { timeout: 15000 });
  const paused = await waitFor(() => page.locator('#banner:not([hidden])', { hasText: 'open in another tab' }).count(), 6000);
  check('single deck: the older deck tab pauses when another opens', paused === 1);
  check('single deck: the paused tab unloads its columns', await page.locator('.col').count() === 0);
  check('single deck: the new tab is live', await second.locator('.col').count() === 4);
  await second.close();

  // ------------------------------------------------------------------
  // Phase 3: timed auto refresh, per column and per workspace
  // ------------------------------------------------------------------
  await page.close();
  await sleep(600);
  await seed({
    settings: { lazyLoad: false },
    workspaces: [{
      id: 'wt', name: 'Timers', layout: 'columns', gridRows: 2,
      columns: [
        col('user', { handle: 'nasa', tab: 'posts' }, { title: 'A', refreshSec: 15, refreshMode: 'reload' }),
        col('user', { handle: 'esa', tab: 'posts' }, { title: 'B', refreshSec: 15, refreshMode: 'reload' }),
        col('user', { handle: 'cnes', tab: 'posts' }, { title: 'C', refreshSec: 0, refreshMode: 'reload' }),
      ],
    }],
    activeWorkspaceId: 'wt',
  });
  const tp = await context.newPage();
  watchErrors(tp);
  await tp.goto(deckUrl, { waitUntil: 'commit' });
  await tp.waitForSelector('.col');
  const timerOf = (i) => tp.locator('.col').nth(i).locator('.col-timer');
  const timerText = async (i) => ((await timerOf(i).isVisible()) ? (await timerOf(i).textContent()).trim() : '');
  const countFor = (pathName) => requests.filter((r) => r.path === pathName && r.dest === 'iframe').length;

  await waitFor(async () => /next \d+:\d\d/.test(await timerText(0)), 20000);
  check('timer: countdown shows on columns with auto refresh', /next \d+:\d\d/.test(await timerText(0)) && /next \d+:\d\d/.test(await timerText(1)), `${await timerText(0)} | ${await timerText(1)}`);
  check('timer: no countdown on a column with refresh off', (await timerText(2)) === '');

  // Hover B so its frame declines the refresh; A is left alone.
  const boxB = await tp.locator('.col').nth(1).boundingBox();
  await tp.mouse.move(boxB.x + boxB.width / 2, boxB.y + 400);
  await sleep(500);
  const before = { a: countFor('/nasa'), b: countFor('/esa'), c: countFor('/cnes') };
  const aRefreshed = await waitFor(() => countFor('/nasa') > before.a, 30000);
  check('timer: an unhovered column reloads when its timer is due', aRefreshed, `${before.a} -> ${countFor('/nasa')}`);
  await sleep(1500);
  check('timer: a hovered column waits instead of reloading', countFor('/esa') === before.b && /waiting/.test(await timerText(1)), `${countFor('/esa')} vs ${before.b}; label "${await timerText(1)}"`);
  check('timer: a column with refresh off is never reloaded', countFor('/cnes') === before.c);
  await tp.mouse.move(800, 20);
  const bRefreshed = await waitFor(() => countFor('/esa') > before.b, 20000);
  check('timer: the waiting column reloads within seconds of the pointer leaving', bRefreshed, `${before.b} -> ${countFor('/esa')}`);

  // Global pause freezes the countdowns.
  await tp.locator('.topbar .icon-btn[aria-label="Pause auto refresh for every column"]').click();
  await waitFor(async () => /paused/.test(await timerText(0)), 5000);
  const countA = countFor('/nasa');
  check('pause: columns show "paused"', /paused/.test(await timerText(0)) && /paused/.test(await timerText(1)));
  await tp.locator('.topbar .icon-btn[aria-label="Resume auto refresh"]').click();
  await waitFor(async () => /next \d+:\d\d/.test(await timerText(0)), 5000);
  check('pause: resuming restores the countdown without an immediate reload', /next \d+:\d\d/.test(await timerText(0)) && countFor('/nasa') === countA, await timerText(0));

  // Workspace dialog: set every column at once, then one column individually.
  await tp.locator('.topbar .icon-btn[aria-label^="Auto refresh settings"]').click();
  await tp.waitForSelector('dialog[open] .refresh-row');
  await tp.locator('dialog[open] select[aria-label="Interval for all columns"]').selectOption('300');
  await tp.locator('dialog[open] select[aria-label="Method for all columns"]').selectOption('soft');
  await tp.locator('dialog[open] select[aria-label="Interval for C"]').selectOption('60');
  await tp.screenshot({ path: path.join(outDir, '10-refresh-dialog.png') });
  await tp.locator('dialog[open] .btn-primary', { hasText: 'Save' }).click();
  await sleep(800);
  const savedWs = (await sw.evaluate(() => chrome.storage.local.get('workspaces'))).workspaces.find((w) => w.id === 'wt');
  check('workspace dialog: "all columns" applies to every column, per-column override kept',
    JSON.stringify(savedWs.columns.map((c) => [c.refreshSec, c.refreshMode])) === JSON.stringify([[300, 'soft'], [300, 'soft'], [60, 'soft']]),
    JSON.stringify(savedWs.columns.map((c) => [c.refreshSec, c.refreshMode])));
  await waitFor(async () => /next [3-5]:\d\d/.test(await timerText(0)), 8000);
  check('workspace dialog: new intervals show in the column headers', /next [3-5]:\d\d/.test(await timerText(0)) && /next [01]:\d\d/.test(await timerText(2)), `${await timerText(0)} | ${await timerText(2)}`);
  await tp.screenshot({ path: path.join(outDir, '11-timers.png') });

  // ------------------------------------------------------------------
  // Phase 4: grid rows (Auto) and the one-time News migration
  // ------------------------------------------------------------------
  await tp.close();
  await sleep(600);
  const shippedNews = {
    id: 'wn', name: 'News', layout: 'grid', gridRows: 1, activeColumnId: null,
    columns: ['Breaking', 'News links', 'Explore', 'Trending'].map((t) => col('bookmarks', {}, { title: t, refreshSec: 0 })),
  };
  await seed({ settings: { lazyLoad: false }, workspaces: [shippedNews], activeWorkspaceId: 'wn' });
  const gp = await context.newPage();
  watchErrors(gp);
  await gp.goto(deckUrl, { waitUntil: 'commit' });
  await gp.waitForSelector('.col');
  const gridInfo = () => gp.evaluate(() => {
    const cols = document.querySelector('.ws:not([hidden]) .ws-cols');
    const tops = new Set([...document.querySelectorAll('.ws:not([hidden]) .col')].map((c) => Math.round(c.getBoundingClientRect().top)));
    const sel = document.getElementById('grid-rows');
    return { rows: cols.style.getPropertyValue('--grid-rows'), cols: cols.style.getPropertyValue('--grid-cols'), distinctTops: tops.size, value: sel.value, label: sel.options[0].textContent };
  });
  const g1 = await gridInfo();
  check('grid: shipped News default (Grid, 1 row) migrates to Auto and shows 2x2', g1.value === '0' && g1.rows === '2' && g1.cols === '2' && g1.distinctTops === 2, JSON.stringify(g1));
  check('grid: Auto option shows the row count it picks', g1.label === 'Auto (2 rows)', g1.label);
  await gp.screenshot({ path: path.join(outDir, '12-grid-auto.png') });
  await gp.locator('#grid-rows').selectOption('1');
  const g2 = await gridInfo();
  check('grid: choosing 1 row gives one row of four', g2.rows === '1' && g2.cols === '4' && g2.distinctTops === 1, JSON.stringify(g2));
  await sleep(700);
  await gp.reload({ waitUntil: 'commit' });
  await gp.waitForSelector('.col');
  const g3 = await gridInfo();
  check('grid: a deliberate 1 row survives a reload (migration runs once)', g3.value === '1' && g3.rows === '1', JSON.stringify(g3));

  check('deck page logged no errors', deckErrors.length === 0, deckErrors.slice(0, 5).join(' | '));
} catch (err) {
  check('test run completed without exceptions', false, err.stack || String(err));
} finally {
  await context.close();
  server.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(certDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed. Screenshots: ${outDir}`);
process.exit(failed ? 1 : 0);
