// XDeck deck page: workspaces, live x.com columns, layouts, reading pane,
// composer, keyboard shortcuts, unread counters and keyword-alert relay.

import { loadState, planImport, gridRowsFor, autoGridRows, saveWorkspaces, flushWorkspaces, cancelPendingSave, saveSettings, readInbox, INBOX_PREFIX, mergeSettings, normalizeWorkspace, DEFAULT_SETTINGS, LAYOUTS } from './store.js';
import { buildUrl, describe, makeColumn, normalizeColumn, columnFromUrl, safeXUrl, uid, WIDTHS } from './columns.js';
import { h, icon, iconButton, append, clear, toast, popMenu, closeMenu, focusQuietly, confirmDialog, promptDialog, copyText, downloadText } from './dom.js';
import { openColumnEditor, openSettings, openHelp, openRefreshDialog } from './dialogs.js';
import { CollectionsDrawer } from './collections.js';

const X_ORIGINS = new Set(['https://x.com']);
const FRAME_ORIGIN = 'https://x.com';
const FORWARD = /^(Digit[1-9]|Key[NARMCLPS]|BracketLeft|BracketRight)$/;
const IFRAME_ALLOW = 'clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture';

const $ = (id) => document.getElementById(id);
const $rail = $('rail');
const $topbar = $('topbar');
const $workspaces = $('workspaces');
const $reader = $('reader');
const $composer = $('composer');
const $drawer = $('drawer');
const $banner = $('banner');

const app = {
  settings: { ...DEFAULT_SETTINGS },
  workspaces: [],
  activeId: null,
  views: new Map(),       // columnId -> ColumnView
  wsEls: new Map(),       // workspaceId -> { el, tabs, cols, empty, io }
  firstSeen: new Map(),   // postId -> columnId, for cross-column de-duplication
  qsearch: null,
  collections: null,
  booted: false,
  refreshPaused: false,  // pauses every column's auto-refresh timer (not saved)
  lastTick: 0,
  superseded: false,   // another tab opened the deck; this one is paused
  bootPaths: new Set(),  // x.com paths X refuses in frames; opened via the boot page
};

// ---------- helpers ----------

function activeWs() {
  return app.workspaces.find((w) => w.id === app.activeId) || app.workspaces[0];
}

function findColumn(id) {
  for (const ws of app.workspaces) {
    const index = ws.columns.findIndex((c) => c.id === id);
    if (index >= 0) return { ws, col: ws.columns[index], index };
  }
  return null;
}

function save() {
  if (app.superseded) return;
  saveWorkspaces(app.workspaces, app.activeId);
}

function persistSettings() {
  if (app.superseded) return;
  saveSettings(app.settings);
}

// Replace a frame's document without adding an entry to the tab's joint
// session history, which the in-column Back button must not walk through.
function setFrameSrc(iframe, url) {
  try {
    if (iframe.getAttribute('src') && iframe.contentWindow) { iframe.contentWindow.location.replace(url); return; }
  } catch { /* not ready yet */ }
  iframe.src = url;
}

// ---------- loading x.com pages into frames ----------
// X refuses some URLs inside frames even with the deck's header rule (seen for
// /home and /notifications in a logged-in session). A refused load leaves
// Chrome's error page, which is not readable as x.com. Such a path is then
// opened through /i/xdk-boot?go=<path>, where content/frame.js navigates to
// the real page in-app, and remembered so later loads go there directly.

const BOOT_PATH = '/i/xdk-boot';
const BOOT_KEY = 'xdeckBootPaths';

function bootUrl(url) {
  const u = new URL(url);
  return `https://x.com${BOOT_PATH}?go=${encodeURIComponent(u.pathname + u.search)}`;
}

function isBootUrl(url) {
  try { return new URL(url).pathname === BOOT_PATH; } catch { return false; }
}

function pathOf(url) {
  try { return new URL(url).pathname.replace(/\/+$/, '') || '/'; } catch { return ''; }
}

function rememberBootPath(path) {
  if (!path || app.bootPaths.has(path)) return;
  app.bootPaths.add(path);
  chrome.storage.local.set({ [BOOT_KEY]: [...app.bootPaths].slice(-50) }).catch(() => {});
}

class FrameLoader {
  constructor(iframe, { onReady = () => {}, onRefused = () => {} } = {}) {
    this.iframe = iframe;
    this.onReady = onReady;
    this.onRefused = onRefused;
    this.target = '';
    this.requested = '';
    this.retried = false;
    iframe.addEventListener('load', () => this.check());
  }

  go(url) {
    this.target = url;
    this.retried = false;
    this.requested = app.bootPaths.has(pathOf(url)) ? bootUrl(url) : url;
    setFrameSrc(this.iframe, this.requested);
  }

  // Runs after every document load in the frame. A refused load (Chrome's
  // error page) is retried through the boot page: first for a path not yet
  // known to be refused, and once more when the frame was already on the boot
  // route (X reloaded the page itself, e.g. after an update). Only then is the
  // load reported as refused.
  check() {
    if (!this.requested) return;
    let href = '';
    try { href = this.iframe.contentWindow.location.href; } catch { href = ''; }
    if (href === 'about:blank') return;
    if (href.startsWith('https://x.com/')) { this.retried = false; this.onReady(href); return; }
    if (!isBootUrl(this.requested)) {
      rememberBootPath(pathOf(this.target));
      this.requested = bootUrl(this.target);
      setFrameSrc(this.iframe, this.requested);
    } else if (!this.retried) {
      this.retried = true;
      setFrameSrc(this.iframe, this.requested);
    } else {
      this.onRefused(this.target);
    }
  }
}

function samePage(href, url) {
  try {
    const a = new URL(href);
    const b = new URL(url);
    if (a.pathname.replace(/\/+$/, '') !== b.pathname.replace(/\/+$/, '')) return false;
    if (b.pathname === '/search') return a.searchParams.get('q') === b.searchParams.get('q');
    return true;
  } catch {
    return true;
  }
}

function postTo(iframe, msg) {
  try { iframe.contentWindow.postMessage({ ns: 'xdeck', ...msg }, FRAME_ORIGIN); } catch { /* not loaded */ }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
}

function setDragging(on) {
  document.body.classList.toggle('dragging', on);
}

// ---------- column view ----------

class ColumnView {
  constructor(wsId, col) {
    this.wsId = wsId;
    this.col = col;
    this.url = buildUrl(col);
    this.loaded = false;
    this.href = '';
    this.unread = 0;
    this.mark = 0;        // newest post time the column has shown (survives column reloads)
    this.nextAt = 0;      // when the next auto refresh is due (0 = not scheduled yet)
    this.pending = 0;     // when an auto refresh was requested and is awaiting the frame's answer
    this.holding = false; // the frame declined the last request (hovered, scrolled, typing)
    this.timerText = '';
    this.ids = new Set(); // post IDs this column has reported, for de-duplication
    this.build();
    this.loader = new FrameLoader(this.iframe, {
      onReady: (href) => { if (!isBootUrl(href)) this.showReady(); },
      onRefused: (url) => this.showRefused(url),
    });
  }

  build() {
    const d = describe(this.col);
    this.iconEl = h('span', { class: 'col-icon' }, icon(d.icon, 18));
    this.titleEl = h('div', { class: 'col-title' }, d.title);
    this.subTextEl = h('span', null, d.sub);
    this.timerEl = h('span', { class: 'col-timer', hidden: true });
    this.subEl = h('div', { class: 'col-sub' }, this.subTextEl, this.timerEl);
    this.badgeEl = h('button', {
      type: 'button', class: 'badge', hidden: true, title: 'Mark as read and scroll to top',
      onclick: (e) => { e.stopPropagation(); this.setUnread(0); this.post({ type: 'top' }); },
    });
    this.backBtn = iconButton('back', 'Back', (e) => { e.stopPropagation(); this.back(); }, { class: 'col-back' });
    this.backBtn.hidden = true;
    const actions = h('div', { class: 'col-actions' },
      iconButton('arrowUp', 'Scroll to top', () => this.post({ type: 'top' })),
      iconButton('refresh', 'Refresh', () => this.refresh()),
      iconButton('sliders', 'Edit column and filters', () => editColumn(this.col.id)),
      iconButton('more', 'More', (e) => columnMenu(this, e.currentTarget)));
    this.head = h('header', { class: 'col-head', draggable: 'true' },
      this.backBtn, this.iconEl,
      h('div', { class: 'col-titles' }, this.titleEl, this.subEl),
      this.badgeEl, actions);
    this.head.addEventListener('mousedown', () => setActiveColumn(this.col.id, false));
    this.head.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) this.post({ type: 'top' }); });
    this.placeholder = h('div', { class: 'col-placeholder' }, h('div', { class: 'spinner' }), h('span', null, 'Loading'));
    this.iframe = h('iframe', { title: d.title, allow: IFRAME_ALLOW });
    this.body = h('div', { class: 'col-body' }, this.placeholder, this.iframe);
    this.el = h('section', { class: 'col', dataset: { id: this.col.id } }, this.head, this.body);
    this.applyWidth();
    wireDrag(this);
  }

  applyWidth() {
    this.el.style.setProperty('--w', `${WIDTHS[this.col.width] || WIDTHS.medium}px`);
  }

  load() {
    if (this.loaded) return;
    this.loaded = true;
    this.restartTimer();
    this.loader.go(this.url);
  }

  // ----- auto refresh timer (driven by tickRefresh) -----

  restartTimer() {
    this.nextAt = 0;
    this.pending = 0;
    this.holding = false;
  }

  showTimer(text, hold = false) {
    if (this.timerText === text) return;
    this.timerText = text;
    this.timerEl.hidden = !text;
    this.timerEl.textContent = text ? ` \u00b7 ${text}` : '';
    this.timerEl.classList.toggle('hold', hold);
    this.timerEl.title = hold && text === 'waiting'
      ? 'Waiting: the pointer is over this column, it is scrolled down, or you are typing in it. Retrying every 5 seconds.'
      : text === 'paused' ? 'Auto refresh is paused (button in the top bar).' : 'Time until the next auto refresh.';
  }

  tick(now, dt) {
    const sec = +this.col.refreshSec || 0;
    if (sec < 15 || !this.loaded || !this.placeholder.hidden) {
      // off, still loading, or showing an error card
      this.nextAt = 0;
      this.pending = 0;
      this.showTimer('');
      return;
    }
    if (!this.nextAt) this.nextAt = now + sec * 1000;
    if (app.refreshPaused) { this.nextAt += dt; this.showTimer('paused', true); return; }
    if (this.pending) {
      if (now - this.pending > 4000) { this.pending = 0; this.nextAt = now + sec * 1000; } // the frame never answered
      return;
    }
    if (now >= this.nextAt) {
      this.pending = now;
      this.post({ type: 'autoRefresh' });
      return;
    }
    if (this.holding) { this.showTimer('waiting', true); return; }
    const left = Math.ceil((this.nextAt - now) / 1000);
    this.showTimer(`next ${left >= 3600 ? `${Math.floor(left / 3600)}h ${String(Math.floor(left / 60) % 60).padStart(2, '0')}m` : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}`);
  }

  onRefreshResult(done) {
    const sec = +this.col.refreshSec || 0;
    this.pending = 0;
    this.holding = !done;
    this.nextAt = Date.now() + (done ? sec * 1000 : 5000);
  }

  resetPlaceholder() {
    this.placeholder.classList.remove('col-error');
    this.placeholder.replaceChildren(h('div', { class: 'spinner' }), h('span', null, 'Loading'));
    this.placeholder.hidden = false;
  }

  showReady() {
    if (this.placeholder.classList.contains('col-error')) this.resetPlaceholder();
    this.placeholder.hidden = true;
  }

  showRefused(url) {
    this.placeholder.classList.add('col-error');
    this.placeholder.replaceChildren(
      h('strong', null, 'X would not show this page in a column'),
      h('span', null, 'Try again, or open it in a normal tab.'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { this.resetPlaceholder(); this.loader.go(this.url); } }, 'Retry'),
        h('a', { class: 'btn btn-sm', href: safeXUrl(url) || this.url, target: '_blank', rel: 'noopener' }, 'Open in new tab')));
    this.placeholder.hidden = false;
  }

  post(msg) {
    if (this.loaded) postTo(this.iframe, msg);
  }

  sendConfig() {
    this.post({ type: 'config', role: 'column', mark: this.mark, column: { ...this.col, url: this.url, label: describe(this.col).title } });
  }

  update(col) {
    const oldUrl = this.url;
    this.col = col;
    this.url = buildUrl(col);
    const d = describe(col);
    this.titleEl.textContent = d.title;
    this.subTextEl.textContent = d.sub;
    this.restartTimer();
    this.iconEl.replaceChildren(icon(d.icon, 18));
    this.iframe.title = d.title;
    this.applyWidth();
    this.sendConfig();
    if (this.loaded && oldUrl !== this.url) this.navigate(this.url);
    if (col.filters.dedupe) {
      const dups = [...this.ids].filter((id) => isDuplicate(this, id));
      if (dups.length) this.post({ type: 'dups', ids: dups });
    }
  }

  navigate(url) {
    if (!this.loaded) { this.load(); return; }
    this.post({ type: 'navigate', url });
  }

  reset() {
    this.navigate(this.url);
  }

  hardReload() {
    if (!this.loaded) { this.load(); return; }
    this.restartTimer();
    this.resetPlaceholder();
    this.loader.go(this.url);
  }

  // Refresh-by-reload (auto refresh, Refresh button): keep the old content on
  // screen until the new page is ready.
  reloadQuietly() {
    if (!this.loaded) { this.load(); return; }
    this.restartTimer();
    this.loader.go(this.url);
  }

  refresh() {
    if (!this.loaded) { this.load(); return; }
    this.restartTimer();
    if (this.href && !samePage(this.href, this.url)) this.reset();
    else this.post({ type: 'refresh' });
  }

  back() {
    this.post({ type: 'back' });
  }

  setUnread(n) {
    this.unread = Math.max(0, n | 0);
    const show = app.settings.showUnread && this.unread > 0;
    this.badgeEl.hidden = !show;
    this.badgeEl.textContent = this.unread > 99 ? '99+' : String(this.unread);
    scheduleBadges();
  }

  onMessage(m) {
    switch (m.type) {
      case 'hello':
        this.href = String(m.href || '');
        this.backBtn.hidden = samePage(this.href, this.url) || isBootUrl(this.href);
        this.sendConfig();
        break;
      case 'nav':
        this.href = String(m.href || '');
        this.backBtn.hidden = samePage(this.href, this.url) || isBootUrl(this.href);
        if (!isBootUrl(this.href)) this.showReady();
        break;
      case 'navFailed': this.loader.go(safeXUrl(m.url) || this.url); break;
      case 'reloadRequest': this.reloadQuietly(); break;
      case 'refreshResult': this.onRefreshResult(!!m.done); break;
      case 'bootFailed': this.showRefused(this.url); break;
      case 'posts': onPosts(this, m); break;
      case 'read': this.setUnread(0); break;
      case 'focus': setActiveColumn(this.col.id, false); break;
      case 'openDetail': reader.open(m.url); break;
      case 'resetRequest': this.reset(); break;
      case 'key': handleKey(String(m.code || '')); break;
      default: break;
    }
  }

  destroy() {
    this.el.remove();
  }
}

// ---------- posts, unread, alerts ----------

// A post is a duplicate for this view when another live column of the same
// workspace reported it first.
function isDuplicate(view, id) {
  const owner = app.firstSeen.get(id);
  if (!owner || owner === view.col.id) return false;
  const ov = app.views.get(owner);
  return !!(ov && ov.wsId === view.wsId);
}

function onPosts(view, m) {
  if (Number.isFinite(+m.mark) && +m.mark > view.mark) view.mark = +m.mark;
  const ids = Array.isArray(m.ids) ? m.ids.slice(0, 500).map(String) : [];
  const dups = [];
  for (const id of ids) {
    view.ids.add(id);
    if (!app.firstSeen.has(id)) app.firstSeen.set(id, view.col.id);
    else if (view.col.filters.dedupe && isDuplicate(view, id)) dups.push(id);
  }
  if (view.ids.size > 5000) view.ids = new Set([...view.ids].slice(-2000));
  if (app.firstSeen.size > 20000) {
    let n = 0;
    for (const k of app.firstSeen.keys()) { app.firstSeen.delete(k); if (++n >= 5000) break; }
  }
  if (dups.length) view.post({ type: 'dups', ids: dups });
  const fresh = (Array.isArray(m.fresh) ? m.fresh : [])
    .filter((p) => p && p.id && !dups.includes(String(p.id)))
    .slice(0, 100);
  if (!fresh.length) return;
  if (app.settings.showUnread) view.setUnread(view.unread + fresh.length);
  if (view.col.notify) alertFresh(view, fresh);
}

function alertFresh(view, fresh) {
  const label = describe(view.col).title;
  const focused = document.visibilityState === 'visible' && document.hasFocus();
  if (focused) {
    toast(`${label}: ${fresh.length} new post${fresh.length > 1 ? 's' : ''}`, 3500, {
      label: 'Show', onClick: () => setActiveColumn(view.col.id, true),
    });
    return;
  }
  const send = (msg) => chrome.runtime.sendMessage({ type: 'notify', ...msg }).catch(() => {});
  if (fresh.length <= 3) {
    for (const p of fresh) {
      const handle = String(p.handle || '');
      send({
        title: `${p.name || `@${handle}`} (@${handle})`,
        message: String(p.text || (p.hasMedia ? '[media]' : '')),
        contextMessage: `XDeck · ${label}`,
        url: safeXUrl(p.url),
      });
    }
  } else {
    send({
      title: `${label}: ${fresh.length} new posts`,
      message: fresh.slice(0, 3).map((p) => `@${p.handle}: ${String(p.text || '').slice(0, 90)}`).join('\n'),
      contextMessage: 'XDeck',
      url: null,
    });
  }
}

let badgeTimer = null;
function scheduleBadges() {
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(updateBadges, 300);
}

function updateBadges() {
  const perWs = new Map();
  let total = 0;
  for (const v of app.views.values()) {
    perWs.set(v.wsId, (perWs.get(v.wsId) || 0) + v.unread);
    total += v.unread;
  }
  if (!app.settings.showUnread) total = 0;
  for (const b of $topbar.querySelectorAll('.ws-badge')) {
    const n = app.settings.showUnread ? perWs.get(b.dataset.ws) || 0 : 0;
    b.hidden = n === 0;
    b.textContent = n > 99 ? '99+' : String(n);
  }
  const ws = activeWs();
  const rec = ws && app.wsEls.get(ws.id);
  if (rec) {
    for (const b of rec.tabs.querySelectorAll('.tab-badge')) {
      const v = app.views.get(b.dataset.col);
      const n = v && app.settings.showUnread ? v.unread : 0;
      b.hidden = n === 0;
      b.textContent = n > 99 ? '99+' : String(n);
    }
  }
  document.title = total ? `(${total}) XDeck` : 'XDeck';
  chrome.runtime.sendMessage({ type: 'badge', count: total }).catch(() => {});
}

// ---------- reading pane & composer ----------

const reader = {
  iframe: null,
  loaded: false,
  ready: false,     // the frame's content script has said hello
  pending: null,    // URL requested while the first page was still loading
  href: '',
  build() {
    this.iframe = h('iframe', { title: 'Reading pane', allow: IFRAME_ALLOW });
    this.loader = new FrameLoader(this.iframe, {
      onRefused: (url) => toast('X would not show that page here', 4000, { label: 'Open in new tab', onClick: () => window.open(url, '_blank', 'noopener') }),
    });
    this.openTab = h('a', { class: 'icon-btn', target: '_blank', rel: 'noopener', title: 'Open in a new tab', 'aria-label': 'Open in a new tab', href: 'https://x.com/' }, icon('external', 18));
    const handle = h('div', { class: 'reader-resize', title: 'Drag to resize' });
    handle.addEventListener('pointerdown', (e) => startResize(e));
    append($reader, [
      handle,
      h('header', { class: 'pane-head' },
        iconButton('back', 'Back', () => postTo(this.iframe, { type: 'back' })),
        h('div', { class: 'pane-title' }, 'Reading pane'),
        this.openTab,
        iconButton('close', 'Close reading pane', () => this.close())),
      h('div', { class: 'pane-body' }, this.iframe),
    ]);
    $reader.style.setProperty('--rw', `${app.settings.readingPaneWidth || 560}px`);
  },
  open(url) {
    const safe = safeXUrl(url);
    if (!safe) return;
    if (!this.iframe) this.build();
    $reader.hidden = false;
    this.openTab.href = safe;
    if (!this.loaded) { this.loaded = true; this.ready = false; this.loader.go(safe); }
    else if (!this.ready) this.pending = safe;
    else postTo(this.iframe, { type: 'navigate', url: safe });
  },
  close() {
    $reader.hidden = true;
  },
  onMessage(m) {
    if (m.type === 'hello') {
      postTo(this.iframe, { type: 'config', role: 'detail', column: null });
      this.ready = true;
      if (this.pending) { postTo(this.iframe, { type: 'navigate', url: this.pending }); this.pending = null; }
    }
    if (m.type === 'hello' || m.type === 'nav') {
      const safe = safeXUrl(m.href);
      if (safe) { this.href = safe; this.openTab.href = safe; }
    }
    if (m.type === 'navFailed') this.loader.go(safeXUrl(m.url) || this.href);
    if (m.type === 'bootFailed') this.loader.onRefused(this.loader.target);
    if (m.type === 'key') handleKey(String(m.code || ''));
  },
};

function startResize(e) {
  e.preventDefault();
  const startX = e.clientX;
  const startW = $reader.getBoundingClientRect().width;
  setDragging(true);
  const move = (ev) => {
    const w = Math.max(360, Math.min(window.innerWidth - 400, startW + (startX - ev.clientX)));
    $reader.style.setProperty('--rw', `${w}px`);
  };
  const up = () => {
    setDragging(false);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    app.settings.readingPaneWidth = Math.round($reader.getBoundingClientRect().width);
    persistSettings();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

const composer = {
  iframe: null,
  sawCompose: false,
  build() {
    this.iframe = h('iframe', { title: 'New post', allow: IFRAME_ALLOW });
    this.loader = new FrameLoader(this.iframe, {
      onRefused: () => toast('X would not open the composer here', 4000, { label: 'Open in new tab', onClick: () => window.open('https://x.com/compose/post', '_blank', 'noopener') }),
    });
    append($composer, [
      h('header', { class: 'pane-head' },
        h('div', { class: 'pane-title' }, 'New post'),
        iconButton('close', 'Close', () => this.close())),
      h('div', { class: 'pane-body' }, this.iframe),
    ]);
  },
  open() {
    if (!this.iframe) this.build();
    if (!$composer.hidden) { focusQuietly(this.iframe); return; } // keep the draft
    $composer.hidden = false;
    this.sawCompose = false;
    this.loader.go('https://x.com/compose/post');
  },
  close() {
    $composer.hidden = true;
    if (this.iframe) setFrameSrc(this.iframe, 'about:blank');
  },
  toggle() {
    if ($composer.hidden) this.open(); else this.close();
  },
  onMessage(m) {
    if (m.type === 'hello') postTo(this.iframe, { type: 'config', role: 'compose', column: null });
    if (m.type === 'hello' || m.type === 'nav') {
      const href = String(m.href || '');
      if (href.includes('/compose/')) this.sawCompose = true;
      else if (this.sawCompose && !$composer.hidden) setTimeout(() => this.close(), 300); // posted or discarded
    }
    if (m.type === 'bootFailed') this.loader.onRefused(this.loader.target);
    if (m.type === 'key') handleKey(String(m.code || ''));
  },
};

// ---------- frame message router ----------

function frameFor(source) {
  for (const v of app.views.values()) if (v.iframe.contentWindow === source) return v;
  if (reader.iframe && reader.iframe.contentWindow === source) return reader;
  if (composer.iframe && composer.iframe.contentWindow === source) return composer;
  return null;
}

window.addEventListener('message', (e) => {
  if (!X_ORIGINS.has(e.origin)) return;
  const m = e.data;
  if (!m || typeof m !== 'object' || m.ns !== 'xdeck' || typeof m.type !== 'string') return;
  const target = frameFor(e.source);
  if (target) target.onMessage(m);
});

// ---------- workspaces & layouts ----------

function ensureWsEl(ws) {
  let rec = app.wsEls.get(ws.id);
  if (rec) return rec;
  const tabs = h('div', { class: 'ws-tabs', role: 'tablist', hidden: true });
  const cols = h('div', { class: 'ws-cols' });
  const empty = h('div', { class: 'empty', hidden: true },
    h('h2', null, 'This workspace has no columns yet'),
    h('p', null, 'Add Home, Notifications, searches, lists or profiles. Each column is a live x.com view.'),
    h('div', { class: 'empty-actions' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: () => addColumnDialog() }, 'Add column'),
      h('button', { type: 'button', class: 'btn', onclick: () => addColumn(makeColumn('home', { homeTab: 'following' })) }, 'Add Home'),
      h('button', { type: 'button', class: 'btn', onclick: () => addColumn(makeColumn('notifications', { scope: 'all' })) }, 'Add Notifications')));
  const el = h('div', { class: 'ws', dataset: { id: ws.id } }, tabs, cols, empty);
  $workspaces.appendChild(el);
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) { const v = app.views.get(en.target.dataset.id); if (v) v.load(); }
  }, { root: cols, rootMargin: '0px 300px 0px 300px' });
  rec = { el, tabs, cols, empty, io };
  app.wsEls.set(ws.id, rec);
  cols.addEventListener('dragover', onColsDragOver);
  cols.addEventListener('drop', onColsDrop);
  return rec;
}

function renderWorkspace(ws) {
  const rec = ensureWsEl(ws);
  const ids = new Set(ws.columns.map((c) => c.id));
  for (const [id, v] of app.views) {
    if (v.wsId === ws.id && !ids.has(id)) { rec.io.unobserve(v.el); v.destroy(); app.views.delete(id); }
  }
  if (ws.layout === 'tabs' && !ids.has(ws.activeColumnId)) ws.activeColumnId = ws.columns[0] ? ws.columns[0].id : null;
  ws.columns.forEach((col, i) => {
    let v = app.views.get(col.id);
    if (!v) {
      v = new ColumnView(ws.id, col);
      app.views.set(col.id, v);
      rec.cols.appendChild(v.el);
      rec.io.observe(v.el);
    } else if (v.col !== col) {
      v.update(col);
    }
    // Reorder with CSS `order`: moving an iframe in the DOM would reload it.
    v.el.style.order = String(i);
    v.el.classList.toggle('active', ws.layout === 'tabs' && ws.activeColumnId === col.id);
    v.el.classList.toggle('focused', ws.activeColumnId === col.id);
    if (!app.settings.lazyLoad || col.notify) v.load();
  });
  rec.cols.className = `ws-cols l-${ws.layout}`;
  const rows = gridRowsFor(ws);
  const rowsAuto = document.querySelector('#grid-rows option[value="0"]');
  if (rowsAuto && ws.id === app.activeId) rowsAuto.textContent = autoRowsLabel(ws);
  rec.cols.style.setProperty('--grid-rows', String(rows));
  rec.cols.style.setProperty('--grid-cols', String(Math.max(1, Math.ceil(ws.columns.length / rows))));
  renderTabStrip(ws, rec);
  rec.empty.hidden = ws.columns.length > 0;
  rec.cols.hidden = ws.columns.length === 0;
}

function autoRowsLabel(ws) {
  const n = autoGridRows(ws.columns.length);
  return `Auto (${n} row${n > 1 ? 's' : ''})`;
}

function renderTabStrip(ws, rec) {
  rec.tabs.hidden = ws.layout !== 'tabs' || ws.columns.length === 0;
  clear(rec.tabs);
  if (rec.tabs.hidden) return;
  ws.columns.forEach((col) => {
    const d = describe(col);
    const v = app.views.get(col.id);
    const n = v ? v.unread : 0;
    rec.tabs.appendChild(h('button', {
      type: 'button', role: 'tab',
      class: `col-tab${ws.activeColumnId === col.id ? ' on' : ''}`,
      'aria-selected': String(ws.activeColumnId === col.id),
      onclick: () => setActiveColumn(col.id, true),
    }, icon(d.icon, 16), h('span', null, d.title),
    h('span', { class: 'badge tab-badge', hidden: !(app.settings.showUnread && n > 0), dataset: { col: col.id } }, n > 99 ? '99+' : String(n))));
  });
}

function destroyWorkspaceEl(wsId) {
  for (const [cid, v] of app.views) if (v.wsId === wsId) { v.destroy(); app.views.delete(cid); }
  const rec = app.wsEls.get(wsId);
  if (!rec) return;
  rec.io.disconnect();
  rec.el.remove();
  app.wsEls.delete(wsId);
}

function showWorkspace(id) {
  app.activeId = app.workspaces.some((w) => w.id === id) ? id : app.workspaces[0].id;
  for (const ws of app.workspaces) {
    if (ws.id === app.activeId) {
      renderWorkspace(ws);
      app.wsEls.get(ws.id).el.hidden = false;
    } else if (app.wsEls.has(ws.id)) {
      if (app.settings.keepWorkspacesAlive) app.wsEls.get(ws.id).el.hidden = true;
      else destroyWorkspaceEl(ws.id);
    }
  }
  save();
  renderTopbar();
  scheduleBadges();
}

function setLayout(layout) {
  const ws = activeWs();
  ws.layout = layout;
  if (layout === 'tabs' && !ws.activeColumnId && ws.columns[0]) ws.activeColumnId = ws.columns[0].id;
  renderWorkspace(ws);
  renderTopbar();
  save();
}

function cycleLayout() {
  const ws = activeWs();
  setLayout(LAYOUTS[(LAYOUTS.indexOf(ws.layout) + 1) % LAYOUTS.length]);
  toast(`Layout: ${activeWs().layout}`);
}

function setActiveColumn(id, focusFrame) {
  const found = findColumn(id);
  if (!found) return;
  const { ws } = found;
  const changed = ws.activeColumnId !== id;
  ws.activeColumnId = id;
  if (ws.id === app.activeId) {
    if (ws.layout === 'tabs' && changed) renderWorkspace(ws);
    else for (const v of app.views.values()) if (v.wsId === ws.id) v.el.classList.toggle('focused', v.col.id === id);
  }
  if (changed) save();
  if (!focusFrame) return;
  const v = app.views.get(id);
  if (!v) return;
  v.load();
  v.el.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  v.el.classList.remove('flash');
  void v.el.offsetWidth;
  v.el.classList.add('flash');
  try { focusQuietly(v.iframe); } catch { /* ignore */ }
}

function focusColumnIndex(i) {
  const ws = activeWs();
  if (ws.columns[i]) setActiveColumn(ws.columns[i].id, true);
}

// ---------- column operations ----------

function addColumn(col, { focus = true } = {}) {
  const ws = activeWs();
  const c = normalizeColumn(col);
  ws.columns.push(c);
  renderWorkspace(ws);
  save();
  if (focus) setTimeout(() => setActiveColumn(c.id, true), 50);
  return c;
}

function addSearchColumn(query) {
  return addColumn(makeColumn('search', { query, mode: 'live' }, {
    width: app.settings.columnWidth, refreshSec: app.settings.autoRefreshSec,
  }));
}

function addColumnDialog() {
  openColumnEditor({
    column: null,
    isNew: true,
    settings: app.settings,
    onSave: (col) => addColumn(col),
  });
}

function editColumn(id) {
  const found = findColumn(id);
  if (!found) return;
  openColumnEditor({
    column: found.col,
    isNew: false,
    settings: app.settings,
    onSave: (col) => {
      const f = findColumn(id);
      if (!f) return;
      f.ws.columns[f.index] = normalizeColumn({ ...col, id });
      renderWorkspace(f.ws);
      renderTopbar();
      save();
    },
    onDelete: () => removeColumn(id),
  });
}

function removeColumn(id) {
  const found = findColumn(id);
  if (!found) return;
  const { ws, col, index } = found;
  ws.columns.splice(index, 1);
  if (ws.activeColumnId === id) ws.activeColumnId = null;
  renderWorkspace(ws);
  save();
  scheduleBadges();
  const removed = { wsId: ws.id, col, index };
  toast(`Removed "${describe(col).title}"`, 5000, {
    label: 'Undo',
    onClick: () => {
      const w = app.workspaces.find((x) => x.id === removed.wsId);
      if (!w || findColumn(removed.col.id)) return;
      w.columns.splice(Math.min(removed.index, w.columns.length), 0, removed.col);
      if (w.id === app.activeId) renderWorkspace(w);
      save();
    },
  });
}

function moveColumn(id, delta) {
  const found = findColumn(id);
  if (!found) return;
  const { ws, index } = found;
  const to = index + delta;
  if (to < 0 || to >= ws.columns.length) return;
  const [c] = ws.columns.splice(index, 1);
  ws.columns.splice(to, 0, c);
  renderWorkspace(ws);
  save();
}

function duplicateColumn(id) {
  const found = findColumn(id);
  if (!found) return;
  const copy = normalizeColumn({ ...structuredClone(found.col), id: uid() });
  found.ws.columns.splice(found.index + 1, 0, copy);
  renderWorkspace(found.ws);
  save();
}

function columnMenu(view, anchor) {
  const found = findColumn(view.col.id);
  if (!found) return;
  const { ws, index } = found;
  popMenu(anchor, [
    { label: 'Edit column and filters', icon: 'sliders', onClick: () => editColumn(view.col.id) },
    { label: 'Back to column start', icon: 'home', onClick: () => view.reset() },
    { label: 'Reload column', icon: 'refresh', onClick: () => view.hardReload() },
    '-',
    { label: 'Move left', icon: 'chevronLeft', disabled: index === 0, onClick: () => moveColumn(view.col.id, -1) },
    { label: 'Move right', icon: 'chevronRight', disabled: index === ws.columns.length - 1, onClick: () => moveColumn(view.col.id, 1) },
    { label: 'Duplicate', icon: 'duplicate', onClick: () => duplicateColumn(view.col.id) },
    { label: 'Move to workspace...', icon: 'columns', disabled: app.workspaces.length < 2, onClick: () => moveToWorkspace(view.col.id, anchor) },
    '-',
    { label: 'Open in new tab', icon: 'external', onClick: () => window.open(safeXUrl(view.href) || view.url, '_blank', 'noopener') },
    { label: 'Copy link', icon: 'copy', onClick: () => copyText(safeXUrl(view.href) || view.url) },
    '-',
    { label: 'Remove column', icon: 'trash', danger: true, onClick: () => removeColumn(view.col.id) },
  ]);
}

function moveToWorkspace(id, anchor) {
  const found = findColumn(id);
  if (!found) return;
  popMenu(anchor, app.workspaces.filter((w) => w.id !== found.ws.id).map((w) => ({
    label: w.name,
    icon: 'columns',
    onClick: () => {
      const f = findColumn(id);
      if (!f) return;
      const [c] = f.ws.columns.splice(f.index, 1);
      w.columns.push(c);
      renderWorkspace(f.ws);
      if (app.wsEls.has(w.id)) renderWorkspace(w);
      save();
      toast(`Moved to ${w.name}`);
    },
  })));
}

// ---------- drag to reorder ----------

let dragId = null;

function wireDrag(view) {
  view.head.addEventListener('dragstart', (e) => {
    if (e.target.closest && e.target.closest('button')) { e.preventDefault(); return; }
    dragId = view.col.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', view.col.id);
    setTimeout(() => { setDragging(true); view.el.classList.add('drag-src'); }, 0);
  });
  view.head.addEventListener('dragend', () => {
    dragId = null;
    setDragging(false);
    for (const el of document.querySelectorAll('.drag-src, .drop-before, .drop-after')) el.classList.remove('drag-src', 'drop-before', 'drop-after');
  });
}

function dropTarget(e) {
  const colEl = e.target.closest && e.target.closest('.col');
  if (!colEl || colEl.dataset.id === dragId) return null;
  const r = colEl.getBoundingClientRect();
  return { colEl, before: e.clientX < r.left + r.width / 2 };
}

function onColsDragOver(e) {
  if (!dragId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  for (const el of document.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
  const t = dropTarget(e);
  if (t) t.colEl.classList.add(t.before ? 'drop-before' : 'drop-after');
}

function onColsDrop(e) {
  if (!dragId) return;
  e.preventDefault();
  const t = dropTarget(e);
  const id = dragId;
  dragId = null;
  setDragging(false);
  if (!t) return;
  const ws = activeWs();
  const from = ws.columns.findIndex((c) => c.id === id);
  if (from < 0) return;
  const [c] = ws.columns.splice(from, 1);
  let to = ws.columns.findIndex((x) => x.id === t.colEl.dataset.id);
  if (!t.before) to += 1;
  ws.columns.splice(to, 0, c);
  renderWorkspace(ws);
  save();
}

// ---------- workspace operations ----------

async function addWorkspace() {
  const name = await promptDialog('New workspace', `Workspace ${app.workspaces.length + 1}`, { label: 'Name', okLabel: 'Create' });
  if (!name) return;
  const ws = normalizeWorkspace({ id: uid('w'), name, layout: 'columns', columns: [] });
  app.workspaces.push(ws);
  showWorkspace(ws.id);
}

async function renameWorkspace(id) {
  const ws = app.workspaces.find((w) => w.id === id);
  if (!ws) return;
  const name = await promptDialog('Rename workspace', ws.name, { label: 'Name' });
  if (!name) return;
  ws.name = name.slice(0, 40);
  renderTopbar();
  save();
}

function duplicateWorkspace(id) {
  const ws = app.workspaces.find((w) => w.id === id);
  if (!ws) return;
  const copy = normalizeWorkspace({
    ...structuredClone(ws),
    id: uid('w'),
    name: `${ws.name} copy`.slice(0, 40),
    activeColumnId: null,
    columns: ws.columns.map((c) => ({ ...structuredClone(c), id: uid() })),
  });
  app.workspaces.splice(app.workspaces.indexOf(ws) + 1, 0, copy);
  showWorkspace(copy.id);
}

async function deleteWorkspace(id) {
  if (app.workspaces.length < 2) { toast('Keep at least one workspace'); return; }
  const ws = app.workspaces.find((w) => w.id === id);
  if (!ws) return;
  if (!(await confirmDialog(`Delete workspace "${ws.name}" and its ${ws.columns.length} columns?`, { okLabel: 'Delete', danger: true }))) return;
  destroyWorkspaceEl(id);
  app.workspaces = app.workspaces.filter((w) => w.id !== id);
  showWorkspace(app.activeId === id ? app.workspaces[0].id : app.activeId);
}

function moveWorkspace(id, delta) {
  const i = app.workspaces.findIndex((w) => w.id === id);
  const to = i + delta;
  if (i < 0 || to < 0 || to >= app.workspaces.length) return;
  const [w] = app.workspaces.splice(i, 1);
  app.workspaces.splice(to, 0, w);
  renderTopbar();
  save();
}

function workspaceMenu(ws, anchor) {
  const i = app.workspaces.indexOf(ws);
  popMenu(anchor, [
    { label: 'Rename', icon: 'pen', onClick: () => renameWorkspace(ws.id) },
    { label: 'Auto refresh...', icon: 'timer', onClick: () => refreshDialog(ws.id) },
    { label: 'Duplicate', icon: 'duplicate', onClick: () => duplicateWorkspace(ws.id) },
    { label: 'Move left', icon: 'chevronLeft', disabled: i === 0, onClick: () => moveWorkspace(ws.id, -1) },
    { label: 'Move right', icon: 'chevronRight', disabled: i === app.workspaces.length - 1, onClick: () => moveWorkspace(ws.id, 1) },
    '-',
    { label: 'Delete workspace', icon: 'trash', danger: true, disabled: app.workspaces.length < 2, onClick: () => deleteWorkspace(ws.id) },
  ]);
}

function switchWorkspace(delta) {
  const i = app.workspaces.findIndex((w) => w.id === app.activeId);
  const next = app.workspaces[(i + delta + app.workspaces.length) % app.workspaces.length];
  if (next) showWorkspace(next.id);
}

// ---------- global actions ----------

function markAllRead() {
  for (const v of app.views.values()) if (v.wsId === app.activeId) v.setUnread(0);
}

// One ticker for every column timer. Timestamps (not tick counts) drive the
// countdowns, so they stay correct when Chrome throttles a background tab.
function tickRefresh() {
  const now = Date.now();
  const dt = Math.max(0, now - (app.lastTick || now));
  app.lastTick = now;
  if (app.superseded) return;
  for (const v of app.views.values()) v.tick(now, dt);
}

function toggleRefreshPause() {
  app.refreshPaused = !app.refreshPaused;
  renderTopbar();
  tickRefresh();
  toast(app.refreshPaused ? 'Auto refresh paused for every column' : 'Auto refresh resumed');
}

function refreshDialog(wsId) {
  const ws = app.workspaces.find((w) => w.id === wsId);
  if (!ws) return;
  openRefreshDialog({
    workspace: ws,
    titleOf: (c) => describe(c).title,
    onApply: (list) => {
      const byId = new Map(list.map((x) => [x.id, x]));
      ws.columns = ws.columns.map((c) => (byId.has(c.id) ? normalizeColumn({ ...c, ...byId.get(c.id) }) : c));
      if (ws.id === app.activeId) renderWorkspace(ws);
      save();
      const active = ws.columns.filter((c) => c.refreshSec >= 15).length;
      toast(`Auto refresh set: ${active} of ${ws.columns.length} columns`);
    },
  });
}

function refreshAll() {
  for (const v of app.views.values()) if (v.wsId === app.activeId && v.loaded) v.refresh();
  toast('Refreshing columns');
}

function toggleReadingPane() {
  app.settings.readingPane = !app.settings.readingPane;
  persistSettings();
  if (!app.settings.readingPane) reader.close();
  renderTopbar();
  toast(app.settings.readingPane ? 'Reading pane on: clicked posts open on the right' : 'Reading pane off');
}

function applySettings(next) {
  const prev = app.settings;
  app.settings = mergeSettings(next);
  persistSettings();
  applyTheme();
  if (prev.keepWorkspacesAlive && !app.settings.keepWorkspacesAlive) {
    for (const id of [...app.wsEls.keys()]) if (id !== app.activeId) destroyWorkspaceEl(id);
  }
  if (!app.settings.readingPane) reader.close();
  renderWorkspace(activeWs());
  for (const v of app.views.values()) v.setUnread(v.unread);
  renderTopbar();
}

function applyTheme() {
  const s = app.settings;
  document.documentElement.dataset.theme = ['dark', 'dim', 'light'].includes(s.theme) ? s.theme : 'dark';
  document.documentElement.style.setProperty('--accent', /^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : DEFAULT_SETTINGS.accent);
}

function describeImport(plan, replacing) {
  const s = plan.summary;
  const parts = [
    `Replace your ${replacing} workspace${replacing === 1 ? '' : 's'} with ${s.workspaces} from this file (${s.columns} column${s.columns === 1 ? '' : 's'})?`,
  ];
  if (s.settingsChanged.length) parts.push(`It also changes these settings: ${s.settingsChanged.join(', ')}.`);
  if (s.notify) parts.push(`${s.notify} column${s.notify === 1 ? '' : 's'} will send desktop alerts.`);
  if (s.regexTerms) parts.push(`${s.regexTerms} filter${s.regexTerms === 1 ? '' : 's'} use regular expressions.`);
  const dropped = [];
  if (s.droppedWorkspaces) dropped.push(`${s.droppedWorkspaces} workspace${s.droppedWorkspaces === 1 ? '' : 's'}`);
  if (s.droppedColumns) dropped.push(`${s.droppedColumns} column${s.droppedColumns === 1 ? '' : 's'}`);
  if (s.droppedNotify) dropped.push(`alerts on ${s.droppedNotify} column${s.droppedNotify === 1 ? '' : 's'}`);
  if (dropped.length) parts.push(`Over the limits, not imported: ${dropped.join(', ')}.`);
  parts.push('You can undo this right afterwards.');
  return parts.join(' ');
}

// Returns true when the import was applied (the settings dialog then closes).
async function importWorkspaces(data) {
  const plan = planImport(data, app.settings); // throws with a message for the user
  if (!(await confirmDialog(describeImport(plan, app.workspaces.length), { okLabel: 'Replace' }))) return false;
  const before = { workspaces: app.workspaces, settings: app.settings, activeId: app.activeId };
  for (const id of [...app.wsEls.keys()]) destroyWorkspaceEl(id);
  app.workspaces = plan.workspaces;
  applySettings({ ...app.settings, ...plan.settings, clean: { ...app.settings.clean, ...(plan.settings.clean || {}) } });
  showWorkspace(app.workspaces[0].id);
  toast(`Imported ${app.workspaces.length} workspace${app.workspaces.length === 1 ? '' : 's'}`, 12000, {
    label: 'Undo',
    onClick: () => {
      for (const id of [...app.wsEls.keys()]) destroyWorkspaceEl(id);
      app.workspaces = before.workspaces;
      applySettings(before.settings);
      showWorkspace(app.workspaces.some((w) => w.id === before.activeId) ? before.activeId : app.workspaces[0].id);
      toast('Import undone');
    },
  });
  return true;
}

function settingsDialog() {
  openSettings({
    settings: app.settings,
    onChange: applySettings,
    onExport: () => {
      const data = { app: 'XDeck', version: 1, exportedAt: new Date().toISOString(), settings: app.settings, workspaces: app.workspaces };
      downloadText(`xdeck-workspaces-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
    },
    onImport: importWorkspaces,
    onReset: async () => {
      if (!(await confirmDialog('Reset all settings and workspaces to the defaults? Collections are kept.', { okLabel: 'Reset', danger: true }))) return false;
      await flushWorkspaces();
      await chrome.storage.local.remove(['settings', 'workspaces', 'activeWorkspaceId']);
      location.reload();
      return true;
    },
  });
}

// ---------- chrome: rail & top bar ----------

function logo() {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', '30');
  svg.setAttribute('height', '30');
  svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(svgNs, 'rect');
  bg.setAttribute('width', '32');
  bg.setAttribute('height', '32');
  bg.setAttribute('rx', '8');
  bg.setAttribute('fill', 'var(--accent)');
  svg.appendChild(bg);
  [[7, 8, 18], [14, 8, 13], [21, 8, 16]].forEach(([x, y, hgt]) => {
    const r = document.createElementNS(svgNs, 'rect');
    r.setAttribute('x', String(x));
    r.setAttribute('y', String(y));
    r.setAttribute('width', '4.5');
    r.setAttribute('height', String(hgt));
    r.setAttribute('rx', '1.5');
    r.setAttribute('fill', '#fff');
    svg.appendChild(r);
  });
  return svg;
}

function railBtn(name, title, onClick, cls = '') {
  return h('button', { type: 'button', class: `rail-btn ${cls}`.trim(), title, 'aria-label': title, onclick: onClick }, icon(name, 22));
}

function renderRail() {
  clear($rail);
  append($rail, [
    h('div', { class: 'logo', title: 'XDeck' }, logo()),
    railBtn('pen', 'New post (Alt+N)', () => composer.toggle(), 'compose'),
    railBtn('plus', 'Add column (Alt+A)', () => addColumnDialog()),
    railBtn('search', 'Search X (Alt+S)', () => { if (app.qsearch) app.qsearch.focus(); }),
    railBtn('bookmark', 'Collections (Alt+C)', () => app.collections.toggle()),
    h('div', { class: 'rail-spacer' }),
    railBtn('sliders', 'Settings', settingsDialog),
    railBtn('help', 'Shortcuts and help (?)', () => openHelp()),
  ]);
}

function renderTopbar() {
  clear($topbar);
  const ws = activeWs();
  const tabs = h('div', { class: 'ws-switch', role: 'tablist', 'aria-label': 'Workspaces' },
    app.workspaces.map((w) => h('button', {
      type: 'button',
      role: 'tab',
      class: `ws-tab${w.id === app.activeId ? ' active' : ''}`,
      'aria-selected': String(w.id === app.activeId),
      title: 'Click to switch, double-click to rename, right-click for more',
      onclick: () => { if (w.id !== app.activeId) showWorkspace(w.id); },
      ondblclick: () => renameWorkspace(w.id),
      oncontextmenu: (e) => { e.preventDefault(); workspaceMenu(w, e.currentTarget); },
    }, h('span', null, w.name), h('span', { class: 'badge ws-badge', hidden: true, dataset: { ws: w.id } }))),
    iconButton('plus', 'New workspace', addWorkspace, { size: 16, class: 'ws-add' }));

  const q = h('input', { class: 'qsearch-input', type: 'search', placeholder: 'Search X, Enter adds a column', 'aria-label': 'Search X and add a column' });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && q.value.trim()) {
      const col = columnFromUrl(q.value.trim());
      if (col && /^https?:/i.test(q.value.trim())) addColumn(col);
      else addSearchColumn(q.value.trim());
      q.value = '';
      q.blur();
    } else if (e.key === 'Escape') {
      q.blur();
    }
  });
  app.qsearch = q;

  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Layout' },
    [['columns', 'Columns'], ['grid', 'Grid'], ['tabs', 'Tabs']].map(([id, label]) => h('button', {
      type: 'button',
      class: ws.layout === id ? 'on' : '',
      title: `${label} layout (Alt+L cycles)`,
      'aria-pressed': String(ws.layout === id),
      onclick: () => setLayout(id),
    }, icon(id, 16), h('span', null, label))));

  const rows = ws.layout === 'grid'
    ? h('select', {
      id: 'grid-rows', class: 'select-sm', title: 'Grid rows', 'aria-label': 'Grid rows',
      onchange: (e) => { ws.gridRows = +e.target.value; renderWorkspace(ws); save(); },
    }, [[0, autoRowsLabel(ws)], ...[1, 2, 3, 4].map((n) => [n, `${n} row${n > 1 ? 's' : ''}`])]
      .map(([n, label]) => h('option', { value: String(n), selected: ws.gridRows === n }, label)))
    : null;

  append($topbar, [
    tabs,
    h('div', { class: 'spacer' }),
    h('label', { class: 'qsearch' }, icon('search', 16), q),
    seg,
    rows,
    iconButton('panel', `Reading pane: ${app.settings.readingPane ? 'on' : 'off'} (Alt+P)`, toggleReadingPane, { class: app.settings.readingPane ? 'on' : '' }),
    iconButton('timer', 'Auto refresh settings for this workspace', () => refreshDialog(ws.id)),
    iconButton(app.refreshPaused ? 'play' : 'pause', app.refreshPaused ? 'Resume auto refresh' : 'Pause auto refresh for every column', toggleRefreshPause, { class: app.refreshPaused ? 'on' : '' }),
    iconButton('checkAll', 'Mark all as read (Alt+M)', markAllRead),
    iconButton('refresh', 'Refresh all columns (Alt+R)', refreshAll),
  ]);
  scheduleBadges();
}

// ---------- keyboard ----------

function handleKey(code) {
  if (/^Digit[1-9]$/.test(code)) { focusColumnIndex(Number(code.slice(5)) - 1); return; }
  switch (code) {
    case 'KeyN': composer.open(); break;
    case 'KeyA': addColumnDialog(); break;
    case 'KeyS': if (app.qsearch) app.qsearch.focus(); break;
    case 'KeyR': refreshAll(); break;
    case 'KeyM': markAllRead(); break;
    case 'KeyC': app.collections.toggle(); break;
    case 'KeyL': cycleLayout(); break;
    case 'KeyP': toggleReadingPane(); break;
    case 'BracketLeft': switchWorkspace(-1); break;
    case 'BracketRight': switchWorkspace(1); break;
    default: break;
  }
}

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  if (e.altKey && !e.ctrlKey && !e.metaKey && FORWARD.test(e.code) && !isTyping(e)) {
    e.preventDefault();
    handleKey(e.code);
    return;
  }
  if (e.key === 'Escape') {
    if (closeMenu()) return;
    if (!$drawer.hidden) { app.collections.close(); return; }
    if (!$composer.hidden) { composer.close(); return; }
    if (!$reader.hidden) { reader.close(); return; }
    return;
  }
  if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '?') { e.preventDefault(); openHelp(); }
  else if (e.key === '/') { e.preventDefault(); if (app.qsearch) app.qsearch.focus(); }
});

// ---------- inbox (context menus, notification clicks) ----------

const handledInbox = new Set();

async function handleInboxItem(key, it) {
  if (!app.booted || app.superseded || handledInbox.has(key) || !it) return;
  handledInbox.add(key);
  await chrome.storage.local.remove(key);
  if (it.action === 'addColumn') {
    const col = columnFromUrl(it.url);
    if (col) addColumn({ ...col, width: app.settings.columnWidth, refreshSec: app.settings.autoRefreshSec });
    else toast('That link is not an x.com page XDeck can show');
  } else if (it.action === 'addSearch' && it.query) {
    addSearchColumn(String(it.query));
  } else if (it.action === 'openDetail' && it.url) {
    reader.open(it.url);
  }
}

async function drainInbox() {
  for (const it of await readInbox()) await handleInboxItem(it.key, it);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, change] of Object.entries(changes)) {
    if (key.startsWith(INBOX_PREFIX) && change.newValue) handleInboxItem(key, change.newValue);
  }
});

// ---------- single active deck, extension updates ----------

function showBanner(text, action) {
  clear($banner);
  append($banner, [
    h('span', null, text),
    action ? h('button', { type: 'button', class: 'btn btn-sm', onclick: action.onClick }, action.label) : null,
  ]);
  $banner.hidden = false;
}

function supersede() {
  if (app.superseded) return;
  app.superseded = true;
  cancelPendingSave();
  for (const id of [...app.wsEls.keys()]) destroyWorkspaceEl(id);
  clear($reader);
  $reader.hidden = true;
  clear($composer);
  $composer.hidden = true;
  app.collections.close();
  showBanner('XDeck is open in another tab, so this one is paused (two decks would overwrite each other).', {
    label: 'Use this tab', onClick: () => location.reload(),
  });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id === chrome.runtime.id && !sender.tab && msg && msg.type === 'deckSuperseded') supersede();
});

function extensionAlive() {
  try { return !!chrome.runtime.id; } catch { return false; }
}

const aliveTimer = setInterval(() => {
  if (extensionAlive()) return;
  clearInterval(aliveTimer);
  showBanner('XDeck was updated or reloaded. Reload this tab to keep using it.', { label: 'Reload', onClick: () => location.reload() });
}, 5000);

// ---------- boot ----------

async function boot() {
  const state = await loadState();
  app.settings = state.settings;
  const stored = await chrome.storage.local.get(BOOT_KEY);
  app.bootPaths = new Set(Array.isArray(stored[BOOT_KEY]) ? stored[BOOT_KEY] : []);
  app.workspaces = state.workspaces;
  app.activeId = state.activeWorkspaceId;
  applyTheme();
  renderRail();
  app.collections = new CollectionsDrawer({ el: $drawer, openReader: (url) => reader.open(url) });

  // The service worker must finish preparing this tab (framing rule) before
  // any column iframe starts loading.
  let ready = false;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'registerDeck' });
    ready = !!(res && res.ok);
  } catch (err) {
    console.error('XDeck: registerDeck failed', err);
  }
  if (!ready) {
    showBanner('XDeck could not prepare this tab, so columns may show "x.com refused to connect". Reload the tab; if that does not help, reload XDeck at chrome://extensions.', {
      label: 'Reload', onClick: () => location.reload(),
    });
  }

  renderTopbar();
  showWorkspace(app.activeId);
  app.booted = true;
  app.lastTick = Date.now();
  setInterval(tickRefresh, 1000);
  drainInbox();
  if (state.firstRun) {
    toast('Welcome to XDeck. Sign in to x.com once in a normal tab if columns ask you to log in. Press ? for shortcuts.', 9000);
  }
}

window.addEventListener('pagehide', () => { flushWorkspaces(); });

boot();
