// Unit tests for the pure parts of src/columns.js and src/store.js (no browser needed).
// Run: npm run test:columns

import { luminance, contrast, onAccent, readableOn, THEME_BACKGROUNDS } from '../src/color.js';
import { SEARCH_PRESETS, columnFromUrl, safeXUrl, NEWS_SITES, RETIRED_DEFAULT_QUERIES, buildSearchQuery, buildUrl, makeColumn } from '../src/columns.js';
import { migrateWorkspaces, migrateGridAuto, autoGridRows, gridRowsFor, normalizeWorkspace, defaultWorkspaces, planImport, IMPORT_LIMITS, DEFAULT_SETTINGS, saveSettings, saveWorkspaces, flushWorkspaces, onSaveFailure } from '../src/store.js';

let failed = 0;
let total = 0;
const eq = (name, got, want) => {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

eq('presets no longer depend on filter:news', SEARCH_PRESETS.filter((p) => p.query.includes('filter:news')).map((p) => p.label), []);
eq('news-sites group is an OR of url: terms', /^\(url:[\w.]+( OR url:[\w.]+)+\)$/.test(NEWS_SITES), true);
const operators = (q) => (q.match(/\b(url|min_faves|filter|lang|from|to):/g) || []).length + (q.match(/\bOR\b/g) || []).length;
eq('every preset stays within 20 operators (X honors about 22)', SEARCH_PRESETS.every((p) => operators(p.query) <= 20), true);
eq('longest preset operator count', Math.max(...SEARCH_PRESETS.map((p) => operators(p.query))), 20);
eq('breaking preset', SEARCH_PRESETS[0].query.startsWith('(breaking OR "just in" OR developing OR urgent) (url:reuters.com'), true);
eq('builder: news sites option', buildSearchQuery({ all: 'ai', newsSites: true }), `ai ${NEWS_SITES}`);
eq('builder: X news filter option kept', buildSearchQuery({ news: true }), 'filter:news');
eq('search URL asks for Latest', buildUrl(makeColumn('search', { query: 'a b', mode: 'live' })), 'https://x.com/search?q=a%20b&src=typed_query&f=live');
eq('empty search falls back to a query that returns results', buildUrl(makeColumn('search', { query: '', mode: 'live' })).includes('filter%3Anews'), false);

// migration of v0.1.0 default columns
const [oldBreaking, oldLinks] = [...RETIRED_DEFAULT_QUERIES.keys()];
const ws = [{ columns: [
  { type: 'search', params: { query: oldBreaking, mode: 'live' } },
  { type: 'search', params: { query: ` ${oldLinks} `, mode: 'live' } },
  { type: 'search', params: { query: 'my own filter:news query', mode: 'live' } },
  { type: 'home', params: {} },
] }];
eq('migration reports a change', migrateWorkspaces(ws), true);
eq('migration rewrites exact old defaults', [ws[0].columns[0].params.query, ws[0].columns[1].params.query], [SEARCH_PRESETS[0].query, SEARCH_PRESETS[1].query]);
eq('migration leaves edited queries alone', ws[0].columns[2].params.query, 'my own filter:news query');
eq('migration is a no-op the second time', migrateWorkspaces(ws), false);
const fresh = defaultWorkspaces();
eq('fresh defaults need no migration', migrateWorkspaces(fresh), false);

// grid rows
eq('auto rows by column count', [0, 1, 3, 4, 6, 8, 9, 20].map(autoGridRows), [1, 1, 1, 2, 2, 2, 3, 3]);
eq('gridRowsFor: Auto follows the column count, a number wins', [gridRowsFor({ gridRows: 0, columns: [1, 2, 3, 4] }), gridRowsFor({ gridRows: 1, columns: [1, 2, 3, 4] })], [2, 1]);
eq('normalize: keeps 2, defaults missing to Auto, clamps to 0..4', [2, undefined, 9, -3].map((g) => normalizeWorkspace({ gridRows: g, columns: [] }).gridRows), [2, 0, 4, 0]);
eq('defaults: both workspaces use Auto rows', defaultWorkspaces().map((w) => w.gridRows), [0, 0]);
const shipped = () => ({ name: 'News', layout: 'grid', gridRows: 1, columns: [{ title: 'Breaking' }, {}, {}, {}] });
const w1 = shipped();
eq('grid migration: the shipped News default becomes Auto', [migrateGridAuto([w1]), w1.gridRows], [true, 0]);
const w2 = { ...shipped(), columns: [{ title: 'Breaking' }, {}, {}] };
const w3 = { ...shipped(), name: 'My news' };
const w4 = { ...shipped(), gridRows: 2 };
eq('grid migration: customised workspaces are left alone', [migrateGridAuto([w2, w3, w4]), w2.gridRows, w3.gridRows, w4.gridRows], [false, 1, 1, 2]);

// ---- workspace import (untrusted file) ----
const col = (extra = {}) => ({ type: 'home', params: {}, filters: {}, ...extra });
const throwsMsg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
eq('import: no workspaces is refused', [throwsMsg(() => planImport({})), throwsMsg(() => planImport({ workspaces: [] })), throwsMsg(() => planImport(null))].every((m) => /No workspaces/.test(m)), true);
const dup = planImport({ workspaces: [{ id: 'same', name: 'A', columns: [col()] }, { id: 'same', name: 'B', columns: [col()] }] });
eq('import: duplicate workspace ids are regenerated', [dup.workspaces[0].id !== dup.workspaces[1].id, dup.workspaces.every((w) => w.id !== 'same')], [true, true]);
const many = planImport({ workspaces: Array.from({ length: 30 }, (_, i) => ({ name: `W${i}`, columns: Array.from({ length: 80 }, () => col()) })) });
eq('import: workspace and column counts are capped and reported', [many.workspaces.length, many.workspaces[0].columns.length, many.summary.droppedWorkspaces, many.summary.droppedColumns], [20, 50, 10, 20 * 30]);
const alerts = planImport({ workspaces: [{ name: 'A', columns: Array.from({ length: 9 }, () => col({ notify: true, refreshSec: 15, refreshMode: 'reload' })) }] });
eq('import: only a few alert columns are kept', [alerts.workspaces[0].columns.filter((c) => c.notify).length, alerts.summary.notify, alerts.summary.droppedNotify], [5, 5, 4]);
const clamp = planImport({ workspaces: [{ name: 'A', columns: [col({ refreshSec: 1 }), col({ refreshSec: 0 }), col({ refreshSec: 99999999 }), col({ refreshSec: 45 })] }] });
eq('import: refresh intervals are clamped (0 stays off)', clamp.workspaces[0].columns.map((c) => c.refreshSec), [15, 0, 86400, 45]);
const junk = planImport({ workspaces: [null, 'x', { name: 'Ok', columns: [null, 5, col()] }] });
eq('import: junk entries are skipped', [junk.workspaces.length, junk.workspaces[0].columns.length], [1, 1]);
const st = planImport({ workspaces: [{ columns: [col()] }], settings: {
  theme: 'neon', accent: 'red', columnWidth: 'constructor', autoRefreshSec: 5, readingPaneWidth: 5000, muteWords: '/(a+)+$/',
  evil: true, __proto__: { polluted: 1 }, cleanRegularTabs: true, showUnread: false, pauseOnHover: 'yes',
  clean: { hidePromoted: false, hideViews: 'x', notAnOption: true },
} }, DEFAULT_SETTINGS);
eq('import: invalid settings values and unknown keys are dropped', Object.keys(st.settings).sort(), ['clean', 'cleanRegularTabs', 'showUnread']);
eq('import: valid settings are kept and changes are listed', [st.settings.cleanRegularTabs, st.settings.showUnread, st.settings.clean, st.summary.settingsChanged.sort()], [true, false, { hidePromoted: false }, ['clean', 'cleanRegularTabs', 'showUnread']]);
eq('import: prototype pollution has no effect', ({}).polluted, undefined);
const okSet = planImport({ workspaces: [{ columns: [col()] }], settings: { theme: 'light', accent: '#A100FF', columnWidth: 'wide', autoRefreshSec: 120, muteWords: 'spoiler, /a{1,3}/', readingPaneWidth: 640 } }, DEFAULT_SETTINGS);
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
eq('import: good settings pass through', sortKeys(okSet.settings), sortKeys({ theme: 'light', accent: '#A100FF', columnWidth: 'wide', autoRefreshSec: 120, muteWords: 'spoiler, /a{1,3}/', readingPaneWidth: 640 }));
const rx = planImport({ workspaces: [{ columns: [col({ filters: { include: '/foo/, bar', exclude: '/x{1,2}/i' } })] }] });
eq('import: regex filters are counted for the confirmation', rx.summary.regexTerms, 2);
eq('import: limits constants', [IMPORT_LIMITS.workspaces, IMPORT_LIMITS.columns, IMPORT_LIMITS.notify, IMPORT_LIMITS.bytes], [20, 50, 5, 1048576]);

// ---- failed writes are reported, not swallowed ----
const errors = [];
onSaveFailure((e) => errors.push(e.message));
globalThis.chrome = { storage: { local: { set: () => { throw new Error('Extension context invalidated.'); } } } };
await saveSettings({});
saveWorkspaces([], 'x'); await flushWorkspaces();
eq('store: synchronous "context invalidated" is reported for settings and workspaces', errors, ['Extension context invalidated.', 'Extension context invalidated.']);
errors.length = 0;
globalThis.chrome = { storage: { local: { set: () => Promise.reject(new Error('QUOTA_BYTES quota exceeded')) } } };
await saveSettings({});
eq('store: a rejected write (quota) is reported', errors, ['QUOTA_BYTES quota exceeded']);
errors.length = 0;
let written = null;
globalThis.chrome = { storage: { local: { set: (x) => { written = x; return Promise.resolve(); } } } };
await saveSettings({ a: 1 });
eq('store: a good write still goes through without a report', [written, errors.length], [{ settings: { a: 1 } }, 0]);

eq('defaults: lazy loading is on (the e2e lazy-loading check relies on it)', DEFAULT_SETTINGS.lazyLoad, true);
// ---- small fixes ----
eq('safeXUrl: the boot hop and the deck itself are never valid targets', [safeXUrl('https://x.com/i/xdk-boot?go=/home'), safeXUrl('https://x.com/i/xdeck'), safeXUrl('https://x.com/home')], [null, null, 'https://x.com/home']);
eq('columnFromUrl: a known explore tab becomes an Explore column, an unknown one a plain URL column', [columnFromUrl('https://x.com/explore/tabs/news').type, columnFromUrl('https://x.com/explore/tabs/for_you').type, columnFromUrl('https://x.com/explore/tabs/for_you').params.url], ['explore', 'custom', 'https://x.com/explore/tabs/for_you']);
// ---- accent colours ----
eq('color: black and white are the extremes', [luminance('#000000'), luminance('#ffffff'), Math.round(contrast('#000000', '#ffffff'))], [0, 1, 21]);
eq('color: button text is black on light accents and white on dark ones', ['#ffd400', '#ff7a00', '#00ba7c', '#1d9bf0', '#a100ff', '#7856ff'].map(onAccent), ['#000000', '#000000', '#000000', '#000000', '#ffffff', '#ffffff']);
eq('color: every swatch gives its button text at least 4.5:1 contrast', ['#1d9bf0', '#7856ff', '#a100ff', '#f91880', '#ff7a00', '#00ba7c', '#ffd400'].every((c) => contrast(c, onAccent(c)) >= 4.5), true);
eq('color: yellow text on white is darkened to 3:1, on black it is left alone', [contrast(readableOn('#ffd400', THEME_BACKGROUNDS.light), THEME_BACKGROUNDS.light) >= 3, readableOn('#ffd400', THEME_BACKGROUNDS.dark)], [true, '#ffd400']);
eq('color: a bad value is returned unchanged', readableOn('red', '#000000'), 'red');

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
