// Fails when a file the extension needs is missing from the checkout: files named in
// manifest.json (content scripts, styles, service worker, icons, web-accessible
// resources) and every relative import in the ES modules. Run in CI on a fresh clone,
// where an uncommitted file shows up as missing. Usage: node tools/check-package.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const missing = [];
const need = (rel, why) => { if (!fs.existsSync(path.join(root, rel))) missing.push(`${rel} (${why})`); };

for (const c of manifest.content_scripts || []) for (const f of [...(c.js || []), ...(c.css || [])]) need(f, 'content script');
need(manifest.background.service_worker, 'service worker');
for (const f of Object.values(manifest.icons || {})) need(f, 'icon');
for (const f of Object.values((manifest.action && manifest.action.default_icon) || {})) need(f, 'toolbar icon');
for (const r of manifest.web_accessible_resources || []) for (const f of r.resources) if (!/[*]/.test(f)) need(f, 'web-accessible resource');

const modules = ['background.js', ...fs.readdirSync(path.join(root, 'src')).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`)];
const importRe = /(?:from|import\()\s*'(\.[^']+)'/g;
for (const f of modules) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  let m;
  while ((m = importRe.exec(text))) need(path.join(path.dirname(f), m[1]), `imported by ${f}`);
}

// Inside a git checkout, every shipped file must also be tracked (a staged-but-uncommitted file breaks clones).
try {
  const tracked = new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean));
  const shipped = ['manifest.json', 'background.js', 'deck.css', ...['src', 'content', 'icons'].flatMap((d) => fs.readdirSync(path.join(root, d)).map((f) => `${d}/${f}`))];
  for (const f of shipped) if (!tracked.has(f)) missing.push(`${f} (shipped but not tracked by git)`);
} catch { /* not a git checkout: skip */ }

if (missing.length) {
  console.error(`Missing files:\n- ${missing.join('\n- ')}`);
  process.exit(1);
}
console.log('package check: every referenced file exists and is tracked');
