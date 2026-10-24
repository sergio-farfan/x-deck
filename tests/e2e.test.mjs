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
  // /messages never loads in a frame, not even through the boot hop (like being offline).
  if (req.headers['sec-fetch-dest'] === 'iframe' && (url.pathname === '/messages' || (url.pathname === '/i/xdk-boot' && url.searchParams.get('go') === '/messages'))) {
    req.socket.destroy();
    return undefined;
  }
  const sendPage = () => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...X_HEADERS });
    res.end(url.pathname.startsWith('/i/xdeck') ? SHELL : timeline);
  };
  // One search is deliberately slow so a test can control which column reports its posts first.
  if (url.pathname === '/search' && url.searchParams.get('q') === 'slowone') setTimeout(sendPage, 4000); else sendPage();
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
  // Remembered only after the hop has delivered the page (the frame's nav message), so wait for it.
  const remembered = await waitFor(async () => {
    const v = (await sw.evaluate(() => chrome.storage.local.get('xdeckBootPaths'))).xdeckBootPaths || [];
    return v.includes('/home') ? v : null;
  }, 10000);
  check('refused pages: refused path remembered for next time', !!remembered, JSON.stringify(remembered));
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
  await sleep(800);
  // By default XDeck does nothing in a normal x.com tab.
  const idle = await normal.evaluate(() => ({ clean: document.documentElement.classList.contains('xdeck-clean'), marks: document.querySelectorAll('[data-xd-kind],[data-xd-hide],.xd-collect').length }));
  check('normal tab: XDeck does nothing by default (no clean mode, marks or buttons)', !idle.clean && idle.marks === 0, JSON.stringify(idle));
  // A page the server serves normally (not one it drops), so only the headers decide: the deck's
  // frames get it, a normal tab's frame is blocked by X-Frame-Options.
  await normal.evaluate(() => { const f = document.createElement('iframe'); f.src = 'https://x.com/explore'; document.body.appendChild(f); });
  await sleep(2500);
  const normalChild = normal.frames().find((f) => f !== normal.mainFrame());
  check('security: x.com stays unframeable in normal tabs (the child ends on the browser error page)', !!normalChild && normalChild.url().startsWith('chrome-error:'), normalChild ? normalChild.url() : 'no frame');
  // Opt in to clean mode on normal tabs, then out again: both must take effect live.
  const setClean = (on) => sw.evaluate(async (v) => { const { settings = {} } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, cleanRegularTabs: v } }); }, on);
  await setClean(true);
  const optedIn = await waitFor(() => normal.evaluate(() => document.documentElement.classList.contains('xdeck-clean') && document.querySelectorAll('.xd-collect').length > 0), 6000);
  check('normal tab: "apply to normal tabs" turns clean mode and the save button on', !!optedIn);
  await setClean(false);
  const optedOut = await waitFor(() => normal.evaluate(() => !document.documentElement.classList.contains('xdeck-clean') && document.querySelectorAll('.xd-collect,[data-xd-kind],[data-xd-hide]').length === 0), 6000);
  check('normal tab: turning it off restores the page', !!optedOut);
  await normal.close();
  // The header rule follows the deck tab: navigating it away releases the rule, coming back and
  // reloading keep it in place.
  await shell.goto('https://x.com/explore', { waitUntil: 'domcontentloaded' });
  const releasedOnNav = await waitFor(async () => (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length === 0, 6000);
  check('security: the header rule is released when the deck tab navigates away', !!releasedOnNav);
  await shell.goto(deckUrl, { waitUntil: 'commit' });
  const backAgain = await waitFor(async () => (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length === 1, 8000);
  check('security: the rule is registered again when the deck is opened again', !!backAgain);
  await shell.reload({ waitUntil: 'commit' });
  await sleep(2000);
  check('security: reloading the deck tab keeps exactly one rule', (await sw.evaluate(() => chrome.declarativeNetRequest.getSessionRules())).length === 1);
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
  check('unread: the column arms itself (new posts count from here)', !!(await waitFor(() => f1.evaluate(() => document.documentElement.hasAttribute('data-xd-armed')), 20000)));
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

  // Freshness follows position, not the post's own timestamp.
  const addCell = (where, id, iso, text, reposted) => f1.evaluate(({ where, id, iso, text, reposted }) => {
    const tl = document.getElementById('timeline');
    const cell = tl.firstElementChild.cloneNode(true);
    cell.querySelector('time').closest('a').setAttribute('href', `/bob/status/${id}`);
    cell.querySelector('time').setAttribute('datetime', iso);
    cell.querySelector('[data-testid="tweetText"]').textContent = text;
    cell.querySelectorAll('.xd-collect').forEach((b) => b.remove());
    cell.setAttribute('data-xd-test', '1');
    if (reposted) { const s = document.createElement('span'); s.setAttribute('data-testid', 'socialContext'); s.textContent = 'Zed reposted'; cell.querySelector('article').prepend(s); }
    tl[where](cell);
  }, { where, id, iso, text, reposted });
  await addCell('prepend', '1010', '2026-10-20T08:00:00.000Z', 'Old post, reposted just now', true);
  check('unread: a new repost of an older post is counted (position, not timestamp)', (await waitFor(() => page.locator('.col').first().locator('.badge:not([hidden])').textContent(), 5000)) === '1');
  await page.locator('.col').first().locator('.badge').click();
  await addCell('append', '1011', '2026-10-19T08:00:00.000Z', 'Older post loaded by scrolling down', false);
  await sleep(1500);
  check('unread: older posts loaded below (scrolling down) are not counted', await page.locator('.col').first().locator('.badge').isHidden());
  await f1.evaluate(() => document.querySelectorAll('[data-xd-test]').forEach((n) => n.remove()));

  // Collect a post, then see it in the Collections drawer.
  await f1.locator('article').nth(1).locator('.xd-collect').click();
  const saved = await waitFor(async () => (await sw.evaluate(() => chrome.storage.local.get('collections'))).collections, 5000);
  check('collect: post saved to collections', saved && saved.length === 1 && saved[0].id === '1001', saved ? saved.map((s) => s.id).join(',') : 'none');
  check('collect: button shows saved state', await f1.locator('article').nth(1).locator('.xd-collect.on').count() === 1);
  await page.locator('.rail-btn[aria-label^="Collections"]').click();
  await page.waitForSelector('.coll-item');
  check('collections: drawer lists the saved post', (await page.locator('.coll-item .coll-text').first().textContent()).includes('Hello world'));
  check('collections: opening the drawer puts keyboard focus in its search box', (await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'))) === 'Search collections');
  await page.locator('.tag-input').first().fill('launch');
  await page.locator('.tag-input').first().press('Enter');
  await waitFor(() => page.locator('.coll-item .tag', { hasText: '#launch' }).count(), 4000);
  check('collections: tag added', await page.locator('.coll-item .tag', { hasText: '#launch' }).count() === 1);
  // Import: one post already saved (gets a new tag) and one new post.
  const importFile = {
    name: 'xdeck-collection.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify([
      { id: '1001', url: 'https://x.com/bob/status/1001', handle: 'bob', name: 'Bob Builder', text: 'Hello world', tags: ['imported'], savedAt: '2026-10-01T00:00:00.000Z' },
      { id: '5005', url: 'https://x.com/zoe/status/5005', handle: 'zoe', name: 'Zoe', text: 'Imported from a file', tags: ['imported'], savedAt: '2026-10-22T00:00:00.000Z' },
      { text: 'no id, skipped' },
    ])),
  };
  await page.locator('.coll-import').setInputFiles(importFile);
  const importToast = await waitFor(() => page.locator('.toast', { hasText: 'Imported:' }).textContent(), 5000);
  check('collections import: toast reports new, merged and skipped', /1 new, 1 merged, 1 skipped/.test(importToast || ''), String(importToast));
  const afterImport = (await sw.evaluate(() => chrome.storage.local.get('collections'))).collections;
  const merged1001 = afterImport.find((c) => c.id === '1001');
  check('collections import: new post added, existing post kept with combined tags',
    afterImport.length === 2 && afterImport.some((c) => c.id === '5005') && JSON.stringify(merged1001.tags) === JSON.stringify(['launch', 'imported']),
    JSON.stringify(afterImport.map((c) => [c.id, c.tags])));
  check('collections import: drawer shows the imported post', await waitFor(() => page.locator('.coll-item .coll-text', { hasText: 'Imported from a file' }).count(), 4000) === 1);
  await page.locator('.coll-import').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# XDeck collection') });
  check('collections import: unsupported file refused with a message', !!(await waitFor(() => page.locator('.toast', { hasText: 'JSON or CSV' }).count(), 4000)));
  // Back to one saved post for the checks that follow.
  await sw.evaluate(() => chrome.storage.local.get('collections').then(({ collections }) => chrome.storage.local.set({ collections: collections.filter((c) => c.id === '1001') })));
  // A tag filter must not stay on after its last post loses the tag.
  await page.locator('.tag-filter .chip', { hasText: '#launch' }).click();
  await page.locator('.coll-item .tag', { hasText: '#launch' }).locator('.tag-x').click();
  await waitFor(() => page.locator('.coll-item').count(), 4000);
  check('collections: removing the last post with the selected tag does not leave an empty, filtered list', await page.locator('.coll-item').count() >= 1 && (await page.locator('.drawer-head .muted').textContent()).startsWith('1 of 1'), await page.locator('.drawer-head .muted').textContent());
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
  // Navigating inside the column and coming back (X reopens Top) must pick Latest again.
  await f2.evaluate(() => { history.replaceState({}, '', '/bob/status/1001'); });
  await sleep(900);
  await f2.evaluate(() => {
    history.replaceState({}, '', '/search?q=launch&src=typed_query&f=live');
    for (const a of document.querySelectorAll('#search-tabs [role="tab"]')) a.setAttribute('aria-selected', String(a.dataset.f === 'top'));
  });
  const latestAgain = await waitFor(() => f2.evaluate(() => document.querySelector('#search-tabs [data-f="live"]').getAttribute('aria-selected') === 'true'), 8000);
  check('search tab: Latest is picked again after navigating inside the column and back', !!latestAgain);
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
  // Unsafe regex in the mute words is refused and the last valid list is kept.
  const muteBox = page.locator('dialog[open] textarea').first();
  await muteBox.fill('/(a+)+$/');
  await muteBox.blur();
  check('settings: unsafe mute-word regex is refused with a message', await page.locator('dialog[open] .form-error:not([hidden])', { hasText: 'cannot be used' }).count() === 1);
  check('settings: the refused mute list is not saved', !((await sw.evaluate(() => chrome.storage.local.get('settings'))).settings || {}).muteWords);
  await muteBox.fill('');
  await muteBox.blur();
  await page.locator('dialog[open] select').first().selectOption('dark');
  await page.locator('dialog[open] .btn-primary', { hasText: 'Done' }).click();
  // Workspace import: confirmation first, then undo.
  const wsBefore = (await sw.evaluate(() => chrome.storage.local.get('workspaces'))).workspaces.length;
  await page.locator('.rail-btn[aria-label="Settings"]').click();
  await page.waitForSelector('dialog[open]');
  const importJson = JSON.stringify({ workspaces: [{ id: 'dupe', name: 'Imported A', columns: [{ type: 'bookmarks', params: {}, notify: true, refreshSec: 1 }] }, { id: 'dupe', name: 'Imported B', columns: [] }], settings: { cleanRegularTabs: true, theme: 'neon' } });
  await page.locator('dialog[open] input[type="file"]').setInputFiles({ name: 'ws.json', mimeType: 'application/json', buffer: Buffer.from(importJson) });
  await page.waitForSelector('dialog[open] .dlg-body p:has-text("Replace your")');
  const importText = await page.locator('dialog[open] .dlg-body p', { hasText: 'Replace your' }).textContent();
  check('import: confirmation names counts, changed settings and alerts', /with 2 from this file \(1 column\)/.test(importText) && /cleanRegularTabs/.test(importText) && /1 column will send desktop alerts/.test(importText) && !/theme/.test(importText), importText);
  await page.locator('dialog[open] .btn', { hasText: 'Cancel' }).last().click();
  await sleep(300);
  check('import: cancelling the confirmation changes nothing', (await sw.evaluate(() => chrome.storage.local.get('workspaces'))).workspaces.length === wsBefore);
  await page.locator('dialog[open] input[type="file"]').setInputFiles({ name: 'ws.json', mimeType: 'application/json', buffer: Buffer.from(importJson) });
  await page.waitForSelector('dialog[open] .dlg-body p:has-text("Replace your")');
  await page.locator('dialog[open] .btn-primary', { hasText: 'Replace' }).click();
  await waitFor(() => page.locator('.ws-tab', { hasText: 'Imported A' }).count(), 5000);
  const imported = (await waitFor(async () => { const w = (await sw.evaluate(() => chrome.storage.local.get('workspaces'))).workspaces; return w.some((x) => x.name === 'Imported A') ? w : null; }, 5000)) || [];
  check('import: replaced with regenerated ids, clamped refresh', imported.length === 2 && imported[0].id !== imported[1].id && imported[0].id !== 'dupe' && imported[0].columns[0].refreshSec === 15, JSON.stringify(imported.map((w) => w.id)));
  await page.locator('.toast-action', { hasText: 'Undo' }).click();
  await waitFor(async () => (await sw.evaluate(() => chrome.storage.local.get('workspaces'))).workspaces.length === wsBefore, 5000);
  check('import: Undo restores the previous workspaces and settings', (await sw.evaluate(() => chrome.storage.local.get('workspaces'))).workspaces.length === wsBefore && !(((await sw.evaluate(() => chrome.storage.local.get('settings'))).settings || {}).cleanRegularTabs));
  await page.keyboard.press('Escape');
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
  await page.keyboard.press('Alt+BracketRight');
  await sleep(500);
  check('single deck: a paused tab ignores workspace shortcuts', await page.locator('.col').count() === 0 && await page.locator('body.superseded').count() === 1);
  await second.close();
  const resumed = await waitFor(async () => (await page.locator('.col').count()) === 4 && (await page.locator('#banner:not([hidden])').count()) === 0, 20000);
  check('single deck: the paused tab resumes when the live deck closes', !!resumed);

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
  const waitingLabel = await waitFor(async () => (/waiting/.test(await timerText(1)) ? await timerText(1) : null), 6000);
  check('timer: a hovered column waits instead of reloading', countFor('/esa') === before.b && !!waitingLabel, `${countFor('/esa')} vs ${before.b}; label "${waitingLabel}"`);
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

  // ------------------------------------------------------------------
  // Phase 5: a page X refuses even through the boot hop; reading-pane recovery
  // ------------------------------------------------------------------
  await gp.close();
  await sleep(600);
  await seed({
    settings: { lazyLoad: false },
    workspaces: [{ id: 'wm', name: 'Msg', layout: 'columns', gridRows: 0, columns: [col('messages', {}, { title: 'Messages' }), col('bookmarks', {}, { title: 'Marks' })] }],
    activeWorkspaceId: 'wm',
    migrations: ['grid-auto-v1'],
  });
  const mp = await context.newPage();
  watchErrors(mp);
  await mp.goto(deckUrl, { waitUntil: 'commit' });
  await mp.waitForSelector('.col');
  const card = await waitFor(() => mp.locator('.col').first().locator('.col-error').textContent(), 25000);
  check('refused everywhere: the column shows the error card with Retry', /X would not show this page in a column/.test(card || '') && await mp.locator('.col').first().locator('.col-error button', { hasText: 'Retry' }).count() === 1, String(card));
  const msgLoads = () => requests.filter((r) => r.path === '/messages' && r.dest === 'iframe').length;
  const loadsBefore = msgLoads();
  await mp.locator('.col').first().locator('.col-error button', { hasText: 'Retry' }).click();
  const retried = await waitFor(() => msgLoads() > loadsBefore, 10000);
  check('refused everywhere: Retry loads the page again', !!retried, `${loadsBefore} -> ${msgLoads()}`);
  check('refused everywhere: and the card comes back when X still refuses', !!(await waitFor(() => mp.locator('.col').first().locator('.col-error').count().then((n) => n === 1), 25000)));
  const rememberedMsg = (await sw.evaluate(() => chrome.storage.local.get('xdeckBootPaths'))).xdeckBootPaths || [];
  check('refused everywhere: a failed hop is not remembered as a refused path', !rememberedMsg.includes('/messages'), JSON.stringify(rememberedMsg));
  check('refused everywhere: other columns still load', await waitFor(async () => {
    const hnd = await mp.locator('.col iframe').nth(1).elementHandle();
    const fr = hnd && await hnd.contentFrame();
    return fr && (await fr.evaluate(() => document.documentElement.classList.contains('xdeck-frame')));
  }, 10000));
  // Reading pane: a refused first load must not leave it dead.
  await sw.evaluate(() => chrome.storage.local.set({ 'inbox:rp-1': { action: 'openDetail', url: 'https://x.com/messages', at: Date.now() } }));
  await waitFor(() => mp.locator('.toast', { hasText: 'would not show that page here' }).count(), 25000);
  await sw.evaluate(() => chrome.storage.local.set({ 'inbox:rp-2': { action: 'openDetail', url: 'https://x.com/bob/status/1001', at: Date.now() } }));
  const readerLoaded = await waitFor(async () => {
    const hnd = await mp.locator('#reader iframe').elementHandle();
    const fr = hnd && await hnd.contentFrame();
    return fr && fr.url() === 'https://x.com/bob/status/1001';
  }, 15000);
  check('reading pane: opens a page after a refused first load', !!readerLoaded);
  await mp.screenshot({ path: path.join(outDir, '13-refused-card.png') });
  await mp.close();

  // ------------------------------------------------------------------
  // Phase 6: unread across a workspace switch; de-duplication after removal
  // ------------------------------------------------------------------
  await sleep(300);
  await seed({
    settings: { lazyLoad: false },
    workspaces: [
      { id: 'wa', name: 'WsA', layout: 'columns', gridRows: 0, columns: [col('search', { query: 'launch', mode: 'live' }, { title: 'A' }), col('search', { query: 'slowone', mode: 'live' }, { title: 'B', filters: { dedupe: true } })] },
      { id: 'wb', name: 'WsB', layout: 'columns', gridRows: 0, columns: [] },
    ],
    activeWorkspaceId: 'wa',
    migrations: ['grid-auto-v1'],
  });
  const up = await context.newPage();
  watchErrors(up);
  await up.goto(deckUrl, { waitUntil: 'commit' });
  await up.waitForSelector('.col');
  // Columns are found by title: after an Undo the restored column is last in the DOM (CSS order keeps it first on screen).
  const colBy = (title) => up.locator('.col', { has: up.locator('.col-title', { hasText: new RegExp(`^${title}$`) }) });
  const upFrame = async (title) => { const hnd = await colBy(title).locator('iframe').elementHandle(); return hnd && hnd.contentFrame(); };
  const fa = await waitFor(() => upFrame('A'), 15000);
  await waitFor(() => fa.evaluate(() => location.pathname === '/search'), 15000);
  const fb = await waitFor(() => upFrame('B'), 15000);
  const dupHidden = await waitFor(() => fb.evaluate(() => document.querySelectorAll('[data-xd-hide="shown in another column"]').length > 0), 20000);
  check('dedupe: the second column hides posts the first one shows', !!dupHidden);
  // Remove the first column: the posts it owned must show again in the second.
  await up.locator('.col').first().locator('.icon-btn[aria-label="More"]').click();
  await up.locator('.menu-item', { hasText: 'Remove column' }).click();
  const dupGone = await waitFor(async () => {
    const f = await upFrame('B');
    return f && (await f.evaluate(() => document.querySelectorAll('[data-xd-hide="shown in another column"]').length === 0 && document.querySelectorAll('[data-testid="cellInnerDiv"]').length > 0));
  }, 10000);
  check('dedupe: posts hidden because of a removed column show again', !!dupGone);
  await up.locator('.toast-action', { hasText: 'Undo' }).click();
  await waitFor(() => up.locator('.col').count().then((n) => n === 2), 4000);
  // Unread survives switching away from the workspace and back.
  const fa2 = await waitFor(async () => { const f = await upFrame('A'); return f && (await f.evaluate(() => location.pathname === '/search' && !!document.getElementById('timeline'))) ? f : null; }, 15000);
  await up.mouse.move(800, 20);
  await sleep(6500);
  await fa2.evaluate(() => {
    const tl = document.getElementById('timeline');
    const cell = tl.firstElementChild.cloneNode(true);
    cell.querySelector('a[href="/bob/status/1001"]').setAttribute('href', '/bob/status/2020');
    cell.querySelector('time').setAttribute('datetime', '2026-10-22T12:00:00.000Z');
    cell.querySelector('[data-testid="tweetText"]').textContent = 'Fresh while away';
    cell.querySelectorAll('.xd-collect').forEach((b) => b.remove());
    tl.prepend(cell);
  });
  const upBadge = await waitFor(() => colBy('A').locator('.badge:not([hidden])').textContent(), 6000);
  check('unread: column shows the new post before switching', upBadge === '1', String(upBadge));
  await up.locator('.ws-tab', { hasText: 'WsB' }).click();
  await sleep(500);
  check('unread: the workspace tab keeps the count while it is unloaded', (await up.locator('.ws-tab', { hasText: 'WsA' }).locator('.ws-badge:not([hidden])').textContent().catch(() => '')) === '1');
  await up.locator('.ws-tab', { hasText: 'WsA' }).click();
  const back = await waitFor(() => colBy('A').locator('.badge:not([hidden])').textContent(), 6000);
  check('unread: the count is still there after switching back', back === '1', String(back));
  await up.close();

  // ------------------------------------------------------------------
  // Phase 7: UI behaviour: menus, dialogs, composer draft, reading pane, toasts, intervals
  // ------------------------------------------------------------------
  await sleep(300);
  await seed({
    settings: { lazyLoad: false, accent: '#ffd400', theme: 'light' },
    workspaces: [{ id: 'wu', name: 'UI', layout: 'columns', gridRows: 0, columns: [col('bookmarks', {}, { title: 'Odd interval', refreshSec: 45 }), col('bookmarks', {}, { title: 'Second', refreshSec: 0 })] }],
    activeWorkspaceId: 'wu',
    migrations: ['grid-auto-v1'],
  });
  const ui = await context.newPage();
  watchErrors(ui);
  await ui.goto(deckUrl, { waitUntil: 'commit' });
  await ui.waitForSelector('.col');
  // Colours: a light accent still gives readable button text.
  const colors = await ui.evaluate(() => { const cs = getComputedStyle(document.documentElement); return [cs.getPropertyValue('--on-accent').trim(), cs.getPropertyValue('--accent-text').trim()]; });
  check('theme: yellow accent gets dark button text and a darkened accent text colour on the light theme', colors[0] === '#000000' && colors[1] !== '#ffd400', JSON.stringify(colors));
  // Menu: arrow keys move, Escape returns focus to the button that opened it.
  const more = ui.locator('.col').first().locator('.icon-btn[aria-label="More"]');
  await more.click();
  await ui.keyboard.press('ArrowDown');
  const focusedItem = await ui.evaluate(() => document.activeElement && document.activeElement.className);
  await ui.keyboard.press('Escape');
  const backOn = await ui.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-label'));
  check('menu: arrow keys move through items and Escape returns focus to the opener', /menu-item/.test(focusedItem) && backOn === 'More', `${focusedItem} / ${backOn}`);
  // Intervals that are not in the list are shown as they are.
  await ui.locator('.col').first().locator('.icon-btn[aria-label="Edit column and filters"]').click();
  await ui.waitForSelector('dialog[open]');
  const shown = await ui.locator('dialog[open] select').nth(1).evaluate((el) => el.options[el.selectedIndex].textContent);
  check('editor: an interval that is not in the list (45 s) is shown, not "Off"', shown === 'Every 45 s', shown);
  await ui.keyboard.press('Escape');
  // Enter in a single-line field submits the dialog.
  await ui.locator('.rail-btn[aria-label^="Add column"]').click();
  await ui.waitForSelector('dialog[open]');
  await ui.locator('dialog[open] .type-card', { hasText: 'Profile' }).click();
  check('editor: the selected column type is exposed with aria-pressed', await ui.locator('dialog[open] .type-card[aria-pressed="true"]', { hasText: 'Profile' }).count() === 1);
  await ui.locator('dialog[open] .source input').fill('@nasa');
  await ui.locator('dialog[open] .source input').press('Enter');
  check('editor: Enter in a text field adds the column', !!(await waitFor(() => ui.locator('.col').count().then((n) => n === 3), 5000)));
  // Composer: Alt+N opens it, the rail button keeps the draft, closing a draft asks first.
  await ui.keyboard.press('Alt+KeyN');
  const cFrame = await waitFor(async () => {
    const hnd = await ui.locator('#composer iframe').elementHandle();
    const fr = hnd && await hnd.contentFrame();
    return fr && (await fr.evaluate(() => location.pathname === '/compose/post' && document.readyState !== 'loading' && !!document.body)) ? fr : null;
  }, 20000);
  await cFrame.evaluate(() => { const d = document.createElement('div'); d.setAttribute('data-testid', 'tweetTextarea_0'); d.setAttribute('contenteditable', 'true'); d.textContent = 'unsent draft'; document.body.appendChild(d); });
  await ui.locator('.rail-btn.compose').click();
  await sleep(400);
  check('composer: the New post button keeps an open draft', await ui.locator('#composer').isVisible() && (await cFrame.evaluate(() => !!document.querySelector('[data-testid="tweetTextarea_0"]'))));
  await ui.locator('#composer .icon-btn[aria-label="Close"]').click();
  await ui.waitForSelector('dialog[open]');
  check('composer: closing a draft asks before discarding it', (await ui.locator('dialog[open] .dlg-body').textContent()).includes('Discard this post?'));
  await ui.locator('dialog[open] .btn', { hasText: 'Cancel' }).last().click();
  check('composer: Cancel keeps the draft', await ui.locator('#composer').isVisible());
  await ui.locator('#composer .icon-btn[aria-label="Close"]').click();
  await ui.waitForSelector('dialog[open]');
  await ui.locator('dialog[open] .btn-danger', { hasText: 'Discard' }).click();
  check('composer: Discard closes it', !!(await waitFor(() => ui.locator('#composer').isHidden(), 4000)));
  // Reading pane: closing unloads the page.
  await sw.evaluate(() => chrome.storage.local.set({ 'inbox:ui-1': { action: 'openDetail', url: 'https://x.com/bob/status/1001', at: Date.now() } }));
  const rFrame = await waitFor(async () => {
    const hnd = await ui.locator('#reader iframe').elementHandle();
    const fr = hnd && await hnd.contentFrame();
    return fr && fr.url() === 'https://x.com/bob/status/1001' ? fr : null;
  }, 20000);
  await ui.locator('#reader .icon-btn[aria-label="Close reading pane"]').click();
  const unloaded = await waitFor(async () => {
    const hnd = await ui.locator('#reader iframe').elementHandle();
    const fr = hnd && await hnd.contentFrame();
    return fr && fr.url() === 'about:blank';
  }, 5000);
  check('reading pane: closing it unloads the page (no sound from a hidden frame)', !!rFrame && !!unloaded);
  // Toasts sit in the top layer, above dialogs.
  await ui.locator('.rail-btn[aria-label="Settings"]').click();
  await ui.waitForSelector('dialog[open]');
  await ui.locator('dialog[open] input[type="file"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json') });
  await ui.waitForSelector('.toast');
  check('toast: shown in the top layer, above an open dialog', await ui.evaluate(() => document.querySelector('.toasts').matches(':popover-open')));
  await ui.keyboard.press('Escape');
  await ui.screenshot({ path: path.join(outDir, '14-ui.png') });
  await ui.close();

  // ------------------------------------------------------------------
  // Phase 8: lazy loading (the shipped default): off-screen columns load when they scroll into view
  // ------------------------------------------------------------------
  await sleep(300);
  await seed({
    // no lazyLoad key at all: the shipped default applies
    workspaces: [{ id: 'wl', name: 'Wide', layout: 'columns', gridRows: 0, columns: Array.from({ length: 10 }, (_, i) => col('bookmarks', {}, { title: `C${i + 1}`, width: 'xwide', refreshSec: 0 })) }],
    activeWorkspaceId: 'wl',
    migrations: ['grid-auto-v1'],
  });
  const lz = await context.newPage();
  watchErrors(lz);
  await lz.goto(deckUrl, { waitUntil: 'commit' });
  await lz.waitForSelector('.col');
  await sleep(2500);
  const loadedNow = await lz.locator('.col iframe[src]').count();
  check('lazy loading: only the visible columns load at first (default settings)', loadedNow > 0 && loadedNow < 10, `${loadedNow} of 10`);
  for (let i = 0; i < 12; i++) { // scroll through the row, as a user would, so each column passes the viewport
    await lz.evaluate(() => { const c = document.querySelector('.ws:not([hidden]) .ws-cols'); c.scrollLeft += 600; });
    await sleep(250);
  }
  const allLoaded = await waitFor(async () => (await lz.locator('.col iframe[src]').count()) === 10, 10000);
  check('lazy loading: scrolling brings the rest in', !!allLoaded, `${await lz.locator('.col iframe[src]').count()} of 10`);
  await lz.close();

  // ------------------------------------------------------------------
  // Phase 9: X's virtual list keeps drawing posts while a column is scrolled
  // (regression: a body overflow rule made <body> the scroller, X's scroll measure stayed 0,
  // and columns went blank after the first screen)
  // ------------------------------------------------------------------
  await sleep(300);
  await seed({
    settings: { lazyLoad: false },
    workspaces: [{ id: 'wv', name: 'Virtual', layout: 'columns', gridRows: 0, columns: [col('list', { list: '777' }, { title: 'Virtual list', refreshSec: 0 })] }],
    activeWorkspaceId: 'wv',
    migrations: ['grid-auto-v1'],
  });
  const vp = await context.newPage();
  watchErrors(vp);
  await vp.goto(deckUrl, { waitUntil: 'commit' });
  await vp.waitForSelector('.col');
  const vf = await waitFor(async () => {
    const hnd = await vp.locator('.col iframe').first().elementHandle();
    const fr = hnd && await hnd.contentFrame();
    return fr && (await fr.evaluate(() => location.pathname === '/i/lists/777' && document.querySelectorAll('[data-testid="cellInnerDiv"]').length > 0)) ? fr : null;
  }, 20000);
  const firstCells = await vf.evaluate(() => document.querySelectorAll('[data-testid="cellInnerDiv"]').length);
  const colBox = await vp.locator('.col').first().locator('iframe').boundingBox();
  await vp.mouse.move(colBox.x + colBox.width / 2, colBox.y + colBox.height / 2);
  for (let i = 0; i < 12; i++) { await vp.mouse.wheel(0, 500); await sleep(120); }
  await sleep(600);
  const after = await vf.evaluate(() => ({
    xScrollY: -document.body.getBoundingClientRect().top,
    bodyScrollTop: document.body.scrollTop,
    maxIndex: Math.max(...[...document.querySelectorAll('[data-testid="cellInnerDiv"] [data-testid="tweetText"]')].map((t) => +t.textContent.replace(/\D/g, ''))),
    bodyOverflow: getComputedStyle(document.body).overflow,
  }));
  check('virtual list: scrolling a column is seen by X (window scrolls, body does not)', after.xScrollY > 3000 && after.bodyScrollTop === 0, JSON.stringify(after));
  check('virtual list: posts beyond the first screen are drawn while scrolling', after.maxIndex >= 25 && firstCells > 0, `first ${firstCells} cells, deepest drawn post ${after.maxIndex}`);
  await vp.screenshot({ path: path.join(outDir, '15-virtual-scroll.png') });
  await vp.close();

  // ------------------------------------------------------------------
  // Phase 10: frames get settings from storage, forged frame messages are ignored, tab order
  // follows the visual column order
  // ------------------------------------------------------------------
  await sleep(300);
  await seed({
    settings: { lazyLoad: false },
    workspaces: [{ id: 'ws', name: 'Sec', layout: 'columns', gridRows: 0, columns: [
      col('bookmarks', {}, { title: 'A', refreshSec: 0, filters: { excludeUsers: '@secret_person', exclude: 'confidential topic' } }),
      col('bookmarks', {}, { title: 'B', refreshSec: 0 }),
      col('bookmarks', {}, { title: 'C', refreshSec: 0 }),
    ] }],
    activeWorkspaceId: 'ws',
    migrations: ['grid-auto-v1'],
  });
  const sp = await context.newPage();
  watchErrors(sp);
  await sp.goto(deckUrl, { waitUntil: 'commit' });
  await sp.waitForSelector('.col');
  const colOf = (title) => sp.locator('.col', { has: sp.locator('.col-title', { hasText: new RegExp(`^${title}$`) }) });
  const frameOf = async (title) => { const hnd = await colOf(title).locator('iframe').elementHandle(); return hnd && hnd.contentFrame(); };
  const fa2x = await waitFor(async () => { const f = await frameOf('A'); return f && (await f.evaluate(() => document.documentElement.classList.contains('xdeck-frame'))) ? f : null; }, 20000);
  // Listen in the frame's MAIN world, as any script on x.com could.
  await fa2x.evaluate(() => { window.__seen = []; window.addEventListener('message', (e) => { window.__seen.push(JSON.stringify(e.data)); }); });
  await colOf('A').locator('.icon-btn[aria-label="Edit column and filters"]').click();
  await sp.waitForSelector('dialog[open]');
  if (!(await sp.locator('dialog[open] details.filters').evaluate((d) => d.open))) await sp.locator('dialog[open] details.filters summary').click();
  await sp.locator('dialog[open] textarea').nth(1).fill('confidential topic, spoiler');
  await sp.locator('dialog[open] .btn-primary').click();
  const applied = await waitFor(() => fa2x.evaluate(() => document.querySelectorAll('[data-xd-hide="excluded word"]').length > 0), 8000);
  const seen = await fa2x.evaluate(() => window.__seen);
  const leaked = seen.filter((m) => /secret_person|confidential|spoiler|excludeUsers|"filters"/.test(m));
  check('privacy: the frame applies the edited filter', !!applied);
  check('privacy: messages the deck posts to a frame carry no filter settings', seen.length > 0 && leaked.length === 0, leaked[0] || `${seen.length} messages, e.g. ${seen[0]}`);
  // Forged messages from a script inside the frame: no effect on the deck.
  const before2 = (await sw.evaluate(() => chrome.storage.local.get('settings'))).settings || {};
  await fa2x.evaluate(() => {
    parent.postMessage({ ns: 'xdeck', type: 'key', code: 'KeyP' }, '*');
    parent.postMessage({ ns: 'xdeck', type: 'openDetail', url: 'https://x.com/bob/status/1001' }, '*');
    parent.postMessage({ ns: 'xdeck', type: 'posts', ids: [], fresh: [{ id: '424242', handle: 'eve', name: 'Eve', text: 'forged alert' }] }, '*');
  });
  await sleep(1200);
  const after2 = (await sw.evaluate(() => chrome.storage.local.get('settings'))).settings || {};
  check('security: a forged message cannot flip a setting', !!before2.readingPane === !!after2.readingPane);
  check('security: a forged message cannot open the reading pane or raise an alert', await sp.locator('#reader').isHidden() && (await sp.locator('.toast', { hasText: 'forged' }).count()) === 0 && (await colOf('A').locator('.badge:not([hidden])').count()) === 0);
  // The frame itself is still trusted (it read the token from storage): it can report posts.
  check('security: the real frame is still trusted', !!(await waitFor(() => fa2x.evaluate(() => document.querySelectorAll('.xd-collect').length > 0), 5000)));
  // Tab order: move A to the right so the DOM order (A, B, C) and the visual order (B, A, C) differ.
  await colOf('A').locator('.icon-btn[aria-label="More"]').click();
  await sp.locator('.menu-item', { hasText: 'Move right' }).click();
  await sleep(400);
  const labels = await sp.evaluate(() => [...document.querySelectorAll('.col')].sort((a, b) => +a.style.order - +b.style.order).map((c) => c.getAttribute('aria-label')));
  check('tab order: columns announce their visual position', JSON.stringify(labels) === JSON.stringify(['B, column 1 of 3', 'A, column 2 of 3', 'C, column 3 of 3']), JSON.stringify(labels));
  await colOf('B').locator('.tab-sentinel').focus();
  const afterB = await sp.evaluate(() => document.activeElement && document.activeElement.closest('.col') && document.activeElement.closest('.col').querySelector('.col-title').textContent);
  check('tab order: Tab out of column B\'s frame reaches A (visually next), not C (next in the DOM)', afterB === 'A', String(afterB));
  await colOf('A').locator('.col-head button:not([hidden])').first().focus();
  await sp.keyboard.press('Shift+Tab');
  const afterShift = await sp.evaluate(() => { const ae = document.activeElement; return ae && ae.tagName === 'IFRAME' ? ae.closest('.col').querySelector('.col-title').textContent : (ae && ae.tagName); });
  check('tab order: Shift+Tab from A\'s header enters B\'s frame (visually previous)', afterShift === 'B', String(afterShift));
  await sp.close();

  // ------------------------------------------------------------------
  // Phase 11: back from a picture or video viewer returns to the previous view in place
  // (regression: the header's back arrow navigated to the column's URL again, so the column
  // redrew from the top instead of showing the post the picture came from)
  // ------------------------------------------------------------------
  await sleep(300);
  await seed({
    settings: { lazyLoad: false, readingPane: true },
    workspaces: [{ id: 'wb', name: 'Back', layout: 'columns', gridRows: 0, columns: [
      col('list', { list: '777' }, { title: 'V', refreshSec: 0 }),
      col('bookmarks', {}, { title: 'K', refreshSec: 0 }),
    ] }],
    activeWorkspaceId: 'wb',
    migrations: ['grid-auto-v1'],
  });
  const bp = await context.newPage();
  watchErrors(bp);
  await bp.goto(deckUrl, { waitUntil: 'commit' });
  await bp.waitForSelector('.col');
  const bcol = (title) => bp.locator('.col', { has: bp.locator('.col-title', { hasText: new RegExp(`^${title}$`) }) });
  const bframe = async (title) => { const hnd = await bcol(title).locator('iframe').elementHandle(); return hnd && hnd.contentFrame(); };
  const fv = await waitFor(async () => { const f = await bframe('V'); return f && (await f.evaluate(() => location.pathname === '/i/lists/777' && document.querySelectorAll('[data-testid="cellInnerDiv"]').length > 0)) ? f : null; }, 20000);
  const fk = await waitFor(async () => { const f = await bframe('K'); return f && (await f.evaluate(() => location.pathname === '/i/bookmarks' && document.documentElement.classList.contains('xdeck-frame'))) ? f : null; }, 20000);
  const viewerOpen = (f) => f.evaluate(() => !!document.querySelector('#layers [aria-modal="true"]'));
  const pathOf = (f) => f.evaluate(() => location.pathname);
  const vbox = await bcol('V').locator('iframe').boundingBox();
  await bp.mouse.move(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
  for (let i = 0; i < 8; i++) { await bp.mouse.wheel(0, 500); await sleep(120); }
  // Open a picture: like X, the viewer is a layer over the timeline at /status/<id>/photo/1.
  const photo = fv.locator('a[data-router] [data-testid="tweetPhoto"]').first();
  await photo.scrollIntoViewIfNeeded(); // the click below must not scroll; the baseline is taken after this
  await sleep(600);
  const scrolled = await fv.evaluate(() => window.scrollY);
  await photo.click();
  await waitFor(() => viewerOpen(fv), 4000);
  const photoPath = await pathOf(fv);
  check('media viewer: clicking a picture opens the viewer over the column', /\/photo\/1$/.test(photoPath) && await viewerOpen(fv) && scrolled > 2000, `${photoPath}, scrolled ${scrolled}`);
  check('media viewer: the column header shows the back arrow', !!(await waitFor(() => bcol('V').locator('.col-back').isVisible(), 3000)));
  await bcol('V').locator('.col-back').click();
  await waitFor(async () => !(await viewerOpen(fv)), 5000);
  const afterBack = await fv.evaluate(() => ({ path: location.pathname, scrollY: window.scrollY, viewer: !!document.querySelector('#layers') }));
  check('media viewer: back closes the viewer and shows the timeline at the same place', afterBack.path === '/i/lists/777' && !afterBack.viewer && Math.abs(afterBack.scrollY - scrolled) < 5, JSON.stringify({ before: scrolled, ...afterBack }));
  check('media viewer: the other column did not move', (await pathOf(fk)) === '/i/bookmarks');
  check('media viewer: the back arrow hides again', !!(await waitFor(() => bcol('V').locator('.col-back').isHidden(), 3000)));
  // Another column navigates while the picture is open: a history traversal would move that
  // column instead, so back must take the in-app route and leave it alone.
  await fv.locator('a[data-router] [data-testid="tweetPhoto"]').first().click();
  await waitFor(() => viewerOpen(fv), 4000);
  await fk.locator('a[data-router] [data-testid="tweetPhoto"]').first().click();
  await waitFor(() => viewerOpen(fk), 4000);
  await sleep(600); // both frames report their navigation
  await bcol('V').locator('.col-back').click();
  await waitFor(async () => (await pathOf(fv)) === '/i/lists/777', 8000);
  check('media viewer: back still works after another column navigated', (await pathOf(fv)) === '/i/lists/777' && !(await viewerOpen(fv)), await pathOf(fv));
  check('media viewer: ...and leaves that other column where it was', await viewerOpen(fk) && (await pathOf(fk)) === '/bob/status/1001/photo/1', await pathOf(fk));
  await bcol('K').locator('.col-back').click();
  await waitFor(async () => !(await viewerOpen(fk)), 5000);
  check('media viewer: that column\'s own back then closes its viewer', (await pathOf(fk)) === '/i/bookmarks', await pathOf(fk));
  // Reading pane: a picture opened from the post shown there, then back, shows that post again.
  await fk.locator('article').nth(1).locator('[data-testid="tweetText"]').first().click();
  const rf = await waitFor(async () => { const hnd = await bp.locator('#reader iframe').elementHandle(); const f = hnd && await hnd.contentFrame(); return f && (await f.evaluate(() => /\/status\/\d+$/.test(location.pathname) && document.documentElement.classList.contains('xdeck-frame'))) ? f : null; }, 10000);
  const postPath = await pathOf(rf);
  await rf.locator('a[data-router] [data-testid="tweetPhoto"]').first().click();
  await waitFor(() => viewerOpen(rf), 4000);
  check('reading pane: a picture opens the viewer over the post', await viewerOpen(rf) && /\/photo\/1$/.test(await pathOf(rf)), await pathOf(rf));
  await bp.locator('#reader .icon-btn[aria-label="Back"]').click();
  await waitFor(async () => !(await viewerOpen(rf)), 5000);
  check('reading pane: back returns to the post', (await pathOf(rf)) === postPath && !(await viewerOpen(rf)), `${postPath} -> ${await pathOf(rf)}`);
  check('reading pane: the columns did not move', (await pathOf(fv)) === '/i/lists/777' && (await pathOf(fk)) === '/i/bookmarks');
  await bp.close();

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
