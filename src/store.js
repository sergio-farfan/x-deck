// Persistent state in chrome.storage.local.
// Keys: settings, workspaces, activeWorkspaceId, collections, inbox:<id>, colcfg.
// colcfg = { <columnId>: { token, type, params, url, label, filters, refreshMode } } written by the
// deck for its frames: a frame's content script reads its own entry from here, so a column's
// settings never travel through page messages that scripts on x.com could read.
// content/frame.js reads `settings` (clean, muteWords, showFiltered,
// readingPane, pauseOnHover, cleanRegularTabs) and reads/writes `collections`;
// keep the key names in sync with it.

import { makeColumn, normalizeColumn, uid, WIDTHS, SEARCH_PRESETS, RETIRED_DEFAULT_QUERIES } from './columns.js';
import { splitTerms, termsError } from './terms.js';

export const DEFAULT_SETTINGS = {
  theme: 'dark',            // dark | dim | light (deck chrome; X itself follows your X display setting)
  accent: '#1d9bf0',
  columnWidth: 'medium',    // default width for new columns
  autoRefreshSec: 60,       // default auto-refresh for new columns (0 = off)
  pauseOnHover: true,
  readingPane: false,       // open clicked posts in the right-hand reading pane
  readingPaneWidth: 560,
  lazyLoad: true,           // load a column only when it first scrolls into view
  keepWorkspacesAlive: false,
  showUnread: true,
  muteWords: '',            // global mute list applied to every column
  showFiltered: false,      // dim filtered posts with the reason instead of hiding them
  cleanRegularTabs: false,  // also apply the clean options to normal x.com tabs
  clean: {
    hidePromoted: true,
    hideWhoToFollow: true,
    hideViews: false,
    hideComposer: true,
    hideTrends: true,
    hidePremium: true,
    hideGrok: true,
    hideTopTabs: false,
  },
};

export const LAYOUTS = ['columns', 'grid', 'tabs'];

// Grid rows: 0 means "Auto". Four columns in a single row look just like the
// Columns layout, so Auto spreads columns over more rows as they are added.
export function autoGridRows(columnCount) {
  if (columnCount <= 3) return 1;
  return columnCount <= 8 ? 2 : 3;
}

export function gridRowsFor(ws) {
  return ws.gridRows > 0 ? ws.gridRows : autoGridRows(ws.columns.length);
}

export function defaultWorkspaces(settings = DEFAULT_SETTINGS) {
  const w = settings.columnWidth;
  const r = settings.autoRefreshSec;
  return [
    {
      id: uid('w'),
      name: 'Main',
      layout: 'columns',
      gridRows: 0,
      activeColumnId: null,
      columns: [
        makeColumn('home', { homeTab: 'following' }, { width: w, refreshSec: r }),
        makeColumn('notifications', { scope: 'all' }, { width: w, refreshSec: r }),
        makeColumn('notifications', { scope: 'mentions' }, { width: w, refreshSec: r }),
        makeColumn('bookmarks', {}, { width: w, refreshSec: 0 }),
      ],
    },
    {
      id: uid('w'),
      name: 'News',
      layout: 'grid',
      gridRows: 0,
      activeColumnId: null,
      columns: [
        makeColumn('search', { query: SEARCH_PRESETS[0].query, mode: 'live' }, { title: 'Breaking', width: w, refreshSec: r }),
        makeColumn('search', { query: SEARCH_PRESETS[1].query, mode: 'live' }, { title: 'News links', width: w, refreshSec: r }),
        makeColumn('explore', { exploreTab: 'news' }, { width: w, refreshSec: 0 }),
        makeColumn('explore', { exploreTab: 'trending' }, { width: w, refreshSec: 0 }),
      ],
    },
  ];
}

export function normalizeWorkspace(ws) {
  return {
    id: ws.id || uid('w'),
    name: String(ws.name || 'Workspace').slice(0, 40),
    layout: LAYOUTS.includes(ws.layout) ? ws.layout : 'columns',
    gridRows: Number.isFinite(+ws.gridRows) ? Math.min(4, Math.max(0, Math.round(+ws.gridRows))) : 0,
    activeColumnId: ws.activeColumnId || null,
    columns: Array.isArray(ws.columns) ? ws.columns.map(normalizeColumn) : [],
  };
}

export function mergeSettings(stored) {
  const s = { ...DEFAULT_SETTINGS, ...(stored || {}) };
  s.clean = { ...DEFAULT_SETTINGS.clean, ...((stored && stored.clean) || {}) };
  const rw = Number(s.readingPaneWidth);
  s.readingPaneWidth = Number.isFinite(rw) ? Math.min(2000, Math.max(360, Math.round(rw))) : DEFAULT_SETTINGS.readingPaneWidth;
  return s;
}

// Replace the exact default queries from v0.1.0 (they relied on filter:news,
// which returns nothing); columns the user edited are left alone.
export function migrateWorkspaces(workspaces) {
  let changed = false;
  for (const ws of workspaces) {
    for (const col of ws.columns) {
      if (col.type !== 'search') continue;
      const next = RETIRED_DEFAULT_QUERIES.get(String((col.params && col.params.query) || '').trim());
      if (next) { col.params.query = next; changed = true; }
    }
  }
  return changed;
}

// v0.1.0 shipped the News workspace as a Grid with 1 row, which looks the same
// as Columns. Switch exactly that default to Auto rows, once (the id is
// remembered so a later deliberate choice of 1 row is kept).
export function migrateGridAuto(workspaces) {
  let changed = false;
  for (const ws of workspaces) {
    if (ws.name === 'News' && ws.layout === 'grid' && ws.gridRows === 1 && ws.columns.length === 4
      && ws.columns[0] && ws.columns[0].title === 'Breaking') {
      ws.gridRows = 0;
      changed = true;
    }
  }
  return changed;
}

// ---------- workspace import ----------
// A workspace file can come from anyone, so it is capped and sanitised before it
// replaces anything: ids are regenerated (a duplicated id would merge two
// workspaces), counts are limited, refresh intervals are clamped, only a few
// alert columns are kept (they load immediately), and only known settings with
// valid values are taken.

export const IMPORT_LIMITS = { bytes: 1024 * 1024, workspaces: 20, columns: 50, notify: 5, minRefresh: 15, maxRefresh: 86400 };

const THEMES = ['dark', 'dim', 'light'];

function importSettings(raw, current) {
  const out = {};
  if (!raw || typeof raw !== 'object') return { settings: out, changed: [] };
  const bool = (v) => typeof v === 'boolean';
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const v = raw[key];
    if (v === undefined || key === 'clean') continue;
    let ok = false;
    if (key === 'theme') ok = THEMES.includes(v);
    else if (key === 'accent') ok = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
    else if (key === 'columnWidth') ok = typeof v === 'string' && Object.prototype.hasOwnProperty.call(WIDTHS, v);
    else if (key === 'autoRefreshSec') ok = Number.isFinite(v) && (v === 0 || (v >= IMPORT_LIMITS.minRefresh && v <= 3600));
    else if (key === 'readingPaneWidth') ok = Number.isFinite(v) && v >= 360 && v <= 2000;
    else if (key === 'muteWords') ok = typeof v === 'string' && v.length <= 5000 && !termsError('Mute words', v);
    else ok = bool(v) && bool(DEFAULT_SETTINGS[key]);
    if (ok) out[key] = v;
  }
  if (raw.clean && typeof raw.clean === 'object') {
    const clean = {};
    for (const key of Object.keys(DEFAULT_SETTINGS.clean)) if (bool(raw.clean[key])) clean[key] = raw.clean[key];
    if (Object.keys(clean).length) out.clean = clean;
  }
  const changed = Object.keys(out).filter((k) => JSON.stringify(k === 'clean' ? { ...current.clean, ...out.clean } : out[k]) !== JSON.stringify(current[k]));
  return { settings: out, changed };
}

// Returns { workspaces, settings, summary } or throws an Error with a message for the user.
export function planImport(data, current = DEFAULT_SETTINGS) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.workspaces) || !data.workspaces.length) {
    throw new Error('No workspaces found in that file.');
  }
  const summary = { workspaces: 0, columns: 0, notify: 0, droppedNotify: 0, droppedWorkspaces: 0, droppedColumns: 0, regexTerms: 0, settingsChanged: [] };
  let notifyLeft = IMPORT_LIMITS.notify;
  const workspaces = [];
  const list = data.workspaces.filter((w) => w && typeof w === 'object');
  summary.droppedWorkspaces = Math.max(0, list.length - IMPORT_LIMITS.workspaces);
  for (const w of list.slice(0, IMPORT_LIMITS.workspaces)) {
    const cols = Array.isArray(w.columns) ? w.columns.filter((c) => c && typeof c === 'object') : [];
    summary.droppedColumns += Math.max(0, cols.length - IMPORT_LIMITS.columns);
    const columns = cols.slice(0, IMPORT_LIMITS.columns).map((c) => {
      const col = normalizeColumn({ ...c, id: uid() });
      if (col.refreshSec > 0) col.refreshSec = Math.min(IMPORT_LIMITS.maxRefresh, Math.max(IMPORT_LIMITS.minRefresh, col.refreshSec));
      if (col.notify) {
        if (notifyLeft > 0) { notifyLeft--; summary.notify++; } else { col.notify = false; summary.droppedNotify++; }
      }
      summary.regexTerms += [col.filters.include, col.filters.exclude].reduce((n, t) => n + splitTerms(t).filter((x) => /^\/.+\/[a-z]*$/.test(x)).length, 0);
      return col;
    });
    summary.columns += columns.length;
    workspaces.push(normalizeWorkspace({ ...w, id: uid('w'), activeColumnId: null, columns }));
  }
  summary.workspaces = workspaces.length;
  const { settings, changed } = importSettings(data.settings, current);
  summary.settingsChanged = changed;
  return { workspaces, settings, summary };
}

export async function loadState() {
  const data = await chrome.storage.local.get(['settings', 'workspaces', 'activeWorkspaceId', 'migrations']);
  const settings = mergeSettings(data.settings);
  const fresh = !(Array.isArray(data.workspaces) && data.workspaces.length);
  const workspaces = fresh ? defaultWorkspaces(settings) : data.workspaces.map(normalizeWorkspace);
  const done = new Set(Array.isArray(data.migrations) ? data.migrations : []);
  let migrated = false;
  // The retired-default query rewrite runs once (it used to run on every load and could
  // rewrite a query the user had built to the same text on purpose).
  if (!done.has('news-queries-v1')) {
    done.add('news-queries-v1');
    if (!fresh) migrateWorkspaces(workspaces);
    migrated = true;
  }
  if (!done.has('grid-auto-v1')) {
    done.add('grid-auto-v1');
    if (!fresh && migrateGridAuto(workspaces)) migrated = true;
    migrated = true; // persist the flag
  }
  const activeWorkspaceId = workspaces.some((w) => w.id === data.activeWorkspaceId) ? data.activeWorkspaceId : workspaces[0].id;
  if (fresh || migrated) await chrome.storage.local.set({ settings, workspaces, activeWorkspaceId, migrations: [...done] });
  return { settings, workspaces, activeWorkspaceId, firstRun: fresh };
}

let wsTimer = null;
let wsPending = null;

export function saveWorkspaces(workspaces, activeWorkspaceId) {
  wsPending = { workspaces, activeWorkspaceId };
  clearTimeout(wsTimer);
  wsTimer = setTimeout(flushWorkspaces, 250);
}

export function cancelPendingSave() {
  clearTimeout(wsTimer);
  wsPending = null;
}

// Writes can fail: the extension was updated or reloaded under an open deck
// ("Extension context invalidated", thrown synchronously or as a rejection),
// or the 10 MB quota is full. The deck registers a handler so it can tell the
// user instead of losing changes silently.
let saveFailureHandler = () => {};
export function onSaveFailure(fn) { saveFailureHandler = typeof fn === 'function' ? fn : () => {}; }

function guardedSet(items) {
  try {
    return Promise.resolve(chrome.storage.local.set(items)).catch((err) => { saveFailureHandler(err); });
  } catch (err) {
    saveFailureHandler(err);
    return Promise.resolve();
  }
}

export function flushWorkspaces() {
  clearTimeout(wsTimer);
  if (!wsPending) return Promise.resolve();
  const p = wsPending;
  wsPending = null;
  return guardedSet(p);
}

export function saveSettings(settings) {
  return guardedSet({ settings });
}

export function saveColumnConfigs(colcfg) {
  return guardedSet({ colcfg });
}

export async function getCollections() {
  const { collections = [] } = await chrome.storage.local.get('collections');
  return collections;
}

// Every change to the collection is applied by the service worker, one at a time
// (see applyCollectionOp), so the deck and the save buttons in every column can
// never overwrite each other. Resolves with the operation's result or throws a
// readable Error (for example when the 10 MB storage quota is full).
export async function collectionOp(op) {
  const res = await chrome.runtime.sendMessage({ type: 'collections', op });
  if (!res || !res.ok) throw new Error((res && res.error) || 'the extension did not answer');
  return res.result || {};
}

// Context-menu and notification actions arrive as one storage key per item
// ("inbox:<id>"), so the service worker and the deck never overwrite each other.
export const INBOX_PREFIX = 'inbox:';

export async function readInbox() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(INBOX_PREFIX))
    .map(([key, item]) => ({ ...item, key }))
    .sort((a, b) => (a.at || 0) - (b.at || 0));
}
