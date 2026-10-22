// Unit tests for the pure parts of src/columns.js and src/store.js (no browser needed).
// Run: npm run test:columns

import { SEARCH_PRESETS, NEWS_SITES, RETIRED_DEFAULT_QUERIES, buildSearchQuery, buildUrl, makeColumn } from '../src/columns.js';
import { migrateWorkspaces, migrateGridAuto, autoGridRows, gridRowsFor, normalizeWorkspace, defaultWorkspaces } from '../src/store.js';

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

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
