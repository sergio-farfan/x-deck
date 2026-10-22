// Persistent state in chrome.storage.local.
// Keys: settings, workspaces, activeWorkspaceId, collections, inbox:<id>.
// content/frame.js reads `settings` (clean, muteWords, showFiltered,
// readingPane, pauseOnHover, cleanRegularTabs) and reads/writes `collections`;
// keep the key names in sync with it.

import { makeColumn, normalizeColumn, uid, SEARCH_PRESETS, RETIRED_DEFAULT_QUERIES } from './columns.js';

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

export async function loadState() {
  const data = await chrome.storage.local.get(['settings', 'workspaces', 'activeWorkspaceId', 'migrations']);
  const settings = mergeSettings(data.settings);
  const fresh = !(Array.isArray(data.workspaces) && data.workspaces.length);
  const workspaces = fresh ? defaultWorkspaces(settings) : data.workspaces.map(normalizeWorkspace);
  const done = new Set(Array.isArray(data.migrations) ? data.migrations : []);
  let migrated = fresh ? false : migrateWorkspaces(workspaces);
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

export function flushWorkspaces() {
  clearTimeout(wsTimer);
  if (!wsPending) return Promise.resolve();
  const p = wsPending;
  wsPending = null;
  return chrome.storage.local.set(p);
}

export function saveSettings(settings) {
  return chrome.storage.local.set({ settings });
}

export async function getCollections() {
  const { collections = [] } = await chrome.storage.local.get('collections');
  return collections;
}

// Read-modify-write so edits from the deck and from in-column buttons don't clobber each other.
export async function updateCollections(fn) {
  const current = await getCollections();
  const next = fn(current.slice()) || current;
  await chrome.storage.local.set({ collections: next });
  return next;
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
