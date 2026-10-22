// Generates Chrome Web Store images into store/out/:
//   icon-128.png          store icon: 96x96 artwork + 16 px transparent padding
//   promo-small-440x280.jpg, promo-marquee-1400x560.jpg   brand tiles (no alpha)
//   screenshot-*.jpg      1280x800, rendered from the real extension UI
// Screenshots use an empty workspace and fictional saved posts, so no personal
// or third-party content appears. Run: node store/make-assets.mjs
// Needs `npm install`, `npx playwright install chromium` and openssl.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'store', 'out');
fs.mkdirSync(out, { recursive: true });
const scratch = path.join(os.homedir(), 'tmp');
fs.mkdirSync(scratch, { recursive: true });

const ACCENT = '#1d9bf0';
const logo = (size) => `<svg viewBox="0 0 32 32" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="8" fill="${ACCENT}"/>
  <rect x="7" y="8" width="4.5" height="18" rx="1.5" fill="#fff"/>
  <rect x="14" y="8" width="4.5" height="13" rx="1.5" fill="#fff"/>
  <rect x="21" y="8" width="4.5" height="16" rx="1.5" fill="#fff"/></svg>`;

// Stylised deck silhouette for the tiles: brand shapes, no text-heavy content.
const deckArt = (cols, h) => `<div style="display:flex;gap:${h * 0.04}px;height:${h}px">${Array.from({ length: cols }, (_, i) => `
  <div style="width:${h * 0.42}px;border-radius:${h * 0.05}px;background:rgba(255,255,255,.16);padding:${h * 0.05}px;display:flex;flex-direction:column;gap:${h * 0.045}px">
    <div style="height:${h * 0.07}px;width:55%;border-radius:99px;background:rgba(255,255,255,.75)"></div>
    ${Array.from({ length: 4 }, (__, j) => `<div style="height:${h * 0.13}px;border-radius:${h * 0.03}px;background:rgba(255,255,255,${0.32 - ((i + j) % 3) * 0.07})"></div>`).join('')}
  </div>`).join('')}</div>`;

const tileHtml = (w, h, withArt) => `<!doctype html><html><body style="margin:0">
  <div style="width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:${withArt ? 'space-between' : 'center'};gap:${h * 0.1}px;
    padding:0 ${withArt ? h * 0.2 : 0}px;box-sizing:border-box;overflow:hidden;
    background:linear-gradient(135deg,#0b5fb0 0%,${ACCENT} 55%,#5ab8ff 100%);font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif">
    <div style="display:flex;align-items:center;gap:${h * 0.08}px">
      ${logo(h * 0.42).replace(`fill="${ACCENT}"`, 'fill="#0a3d73"')}
      <div style="color:#fff;font-weight:800;font-size:${h * 0.24}px;letter-spacing:-.02em">XDeck</div>
    </div>
    ${withArt ? deckArt(4, h * 0.7) : ''}
  </div></body></html>`;

async function brandAssets(browser) {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setViewportSize({ width: 128, height: 128 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:128px;height:128px;display:grid;place-items:center">${logo(96)}</div></body></html>`);
  await page.screenshot({ path: path.join(out, 'icon-128.png'), omitBackground: true });
  for (const [w, h, name, art] of [[440, 280, 'promo-small-440x280.jpg', false], [1400, 560, 'promo-marquee-1400x560.jpg', true]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(tileHtml(w, h, art));
    await page.screenshot({ path: path.join(out, name), type: 'jpeg', quality: 92 });
  }
  await page.close();
}

// ---- screenshots from the real extension (x.com mapped to a local server) ----

const certDir = fs.mkdtempSync(path.join(scratch, 'xdeck-store-cert-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
  '-keyout', path.join(certDir, 'key.pem'), '-out', path.join(certDir, 'cert.pem'),
  '-subj', '/CN=x.com', '-addext', 'subjectAltName=DNS:x.com'], { stdio: 'ignore' });
const server = https.createServer({ key: fs.readFileSync(path.join(certDir, 'key.pem')), cert: fs.readFileSync(path.join(certDir, 'cert.pem')) }, (req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end('<!doctype html><html><head></head><body></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const userDataDir = fs.mkdtempSync(path.join(scratch, 'xdeck-store-profile-'));

const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const demoCollections = [
  { id: '9001', url: 'https://x.com/example_news/status/9001', handle: 'example_news', name: 'Example News Desk', text: 'City council approves the new waterfront transit line; construction starts next spring.', time: iso(25), savedAt: iso(20), tags: ['transit', 'city'], note: 'Follow up on the budget vote.', metrics: { likes: 1840, reposts: 412, replies: 96 } },
  { id: '9002', url: 'https://x.com/sample_labs/status/9002', handle: 'sample_labs', name: 'Sample Labs', text: 'We just published the benchmark results for our open model, including the full evaluation scripts.', time: iso(90), savedAt: iso(80), tags: ['ai'], note: '', metrics: { likes: 5200, reposts: 1300, replies: 240 } },
  { id: '9003', url: 'https://x.com/demo_weather/status/9003', handle: 'demo_weather', name: 'Demo Weather', text: 'Storm watch issued for the coast through Thursday evening. Expect gusts up to 60 mph.', time: iso(180), savedAt: iso(170), tags: ['weather'], note: '', metrics: { likes: 760, reposts: 330, replies: 41 } },
];

async function shots() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', headless: true, ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
    args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, `--host-resolver-rules=MAP x.com 127.0.0.1:${server.address().port}`],
  });
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker');
  await sw.evaluate(async (data) => { await chrome.storage.local.clear(); await chrome.storage.local.set(data); }, {
    workspaces: [{ id: 'w1', name: 'Main', layout: 'columns', gridRows: 0, columns: [] }, { id: 'w2', name: 'News', layout: 'grid', gridRows: 0, columns: [] }],
    activeWorkspaceId: 'w1',
    collections: demoCollections,
    migrations: ['grid-auto-v1'],
  });
  const page = await context.newPage();
  const open = async () => { await page.goto('https://x.com/i/xdeck', { waitUntil: 'commit' }); await page.waitForSelector('.topbar .ws-tab'); await page.waitForTimeout(600); };
  const shot = (name) => page.screenshot({ path: path.join(out, name), type: 'jpeg', quality: 92 });

  await open();
  await page.locator('.rail-btn[aria-label^="Add column"]').click();
  await page.locator('dialog[open] .type-card', { hasText: 'Search' }).click();
  await page.locator('dialog[open] .chip', { hasText: 'Breaking news' }).click();
  await shot('screenshot-1-add-search-column.jpg');
  await page.keyboard.press('Escape');

  await page.locator('.rail-btn[aria-label="Settings"]').click();
  await page.waitForSelector('dialog[open]');
  await page.locator('dialog[open] .form-section h3', { hasText: 'Clean X' }).scrollIntoViewIfNeeded();
  await shot('screenshot-2-settings-clean-x.jpg');
  await page.keyboard.press('Escape');

  await page.locator('.rail-btn[aria-label^="Collections"]').click();
  await page.waitForSelector('.coll-item');
  await shot('screenshot-3-collections.jpg');
  await page.keyboard.press('Escape');

  await page.keyboard.press('?');
  await page.waitForSelector('dialog[open] .keys');
  await shot('screenshot-4-shortcuts.jpg');
  await context.close();
}

const browser = await chromium.launch();
try {
  await brandAssets(browser);
  await shots();
} finally {
  await browser.close();
  server.close();
  fs.rmSync(certDir, { recursive: true, force: true });
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
console.log(`Wrote ${fs.readdirSync(out).join(', ')} to ${out}`);
