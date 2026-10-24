// DOM helpers: element builder (no innerHTML), inline SVG icons, dialogs, toasts.

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICONS = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h5v-6h4v6h5V9.5'],
  bell: ['M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z', 'M10 20a2 2 0 0 0 4 0'],
  search: ['M11 4a7 7 0 1 1 0 14a7 7 0 0 1 0-14Z', 'm20 20-4-4'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3.5 6h.01', 'M3.5 12h.01', 'M3.5 18h.01'],
  user: ['M12 4a4 4 0 1 1 0 8a4 4 0 0 1 0-8Z', 'M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5'],
  bookmark: ['M6 3h12v18l-6-4.5L6 21Z'],
  trending: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
  mail: ['M3 5h18v14H3Z', 'm3 6 9 7 9-7'],
  users: ['M9 4a3.5 3.5 0 1 1 0 7a3.5 3.5 0 0 1 0-7Z', 'M2.5 20c0-3.5 2.9-5.5 6.5-5.5s6.5 2 6.5 5.5', 'M16 4.5a3.5 3.5 0 0 1 0 6.5', 'M18 14.8c2.1.6 3.5 2.4 3.5 5.2'],
  heart: ['M12 20s-7.5-4.6-9.2-9.3C1.6 7.3 3.9 4 7.3 4c2 0 3.6 1.1 4.7 2.7C13.1 5.1 14.7 4 16.7 4c3.4 0 5.7 3.3 4.5 6.7C19.5 15.4 12 20 12 20Z'],
  sparkle: ['M12 3c.6 4.6 2.4 6.4 7 7c-4.6.6-6.4 2.4-7 7c-.6-4.6-2.4-6.4-7-7c4.6-.6 6.4-2.4 7-7Z'],
  link: ['M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1', 'M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1'],
  plus: ['M12 5v14', 'M5 12h14'],
  sliders: ['M4 6h10', 'M18 6h2', 'M16 4v4', 'M4 12h4', 'M12 12h8', 'M10 10v4', 'M4 18h12', 'M18 16v4'],
  filter: ['M3 4h18l-7 8.5V19l-4 2v-8.5Z'],
  pen: ['M4 20h4L19 9l-4-4L4 16Z', 'm13.5 6.5 4 4'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  back: ['M19 12H5', 'm11 6-6 6 6 6'],
  arrowUp: ['M12 19V5', 'm6 11 6-6 6 6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  grid: ['M4 4h7v7H4Z', 'M13 4h7v7h-7Z', 'M4 13h7v7H4Z', 'M13 13h7v7h-7Z'],
  columns: ['M4 4h4v16H4Z', 'M10 4h4v16h-4Z', 'M16 4h4v16h-4Z'],
  tabs: ['M3 9h18v11H3Z', 'M3 9V5h7v4', 'M10 5h5v4'],
  panel: ['M3 4h18v16H3Z', 'M14 4v16'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  check: ['m5 12 5 5 9-10'],
  checkAll: ['m2 12 5 5 9-10', 'm12 16 1 1 9-10'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
  upload: ['M12 20V9', 'm7 14 5-5 5 5', 'M5 4h14'],
  help: ['M12 3a9 9 0 1 1 0 18a9 9 0 0 1 0-18Z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7', 'M12 17h.01'],
  chevronLeft: ['m15 6-6 6 6 6'],
  chevronRight: ['m9 6 6 6-6 6'],
  copy: ['M8 8h12v12H8Z', 'M16 8V4H4v12h4'],
  tag: ['M3 3h8l10 10-8 8L3 11Z', 'M7.5 7.5h.01'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  duplicate: ['M8 8h12v12H8Z', 'M16 8V4H4v12h4', 'M14 11v6', 'M11 14h6'],
  pause: ['M8 5v14', 'M16 5v14'],
  play: ['M7 4l13 8-13 8Z'],
  timer: ['M12 7v5l3 2', 'M12 4a8.5 8.5 0 1 1 0 17a8.5 8.5 0 0 1 0-17Z', 'M9.5 1.5h5'],
};

export function icon(name, size = 18) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', name === 'more' ? '3' : '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] || ICONS.link) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (typeof v !== 'string' && k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function iconButton(name, title, onClick, extra = {}) {
  return h('button', { type: 'button', class: `icon-btn ${extra.class || ''}`.trim(), title, 'aria-label': title, onclick: onClick, ...extra.attrs }, icon(name, extra.size || 18));
}

// ---------- dialogs ----------

export function openDialog({ title, body, actions = [], wide = false, onClose }) {
  const dlg = h('dialog', { class: `dlg${wide ? ' dlg-wide' : ''}` });
  const close = (value) => { if (dlg.open) dlg.close(value || ''); };
  const titleId = `dlg-title-${Math.random().toString(36).slice(2, 8)}`;
  dlg.setAttribute('aria-labelledby', titleId);
  const head = h('header', { class: 'dlg-head' },
    h('h2', { id: titleId }, title),
    iconButton('close', 'Close', () => close()));
  const foot = actions.length
    ? h('footer', { class: 'dlg-foot' }, actions.map((a) => h('button', {
      type: 'button',
      class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''} ${a.left ? 'btn-left' : ''}`.trim(),
      onclick: () => { const keep = a.onClick && a.onClick(close) === false; if (!keep && a.close !== false) close(a.value); },
    }, a.label)))
    : null;
  append(dlg, [head, h('div', { class: 'dlg-body' }, body), foot]);
  dlg.addEventListener('close', () => { if (onClose) onClose(dlg.returnValue); dlg.remove(); });
  // Enter in a single-line field submits the dialog (not while an IME is composing).
  const primary = foot && foot.querySelector('.btn-primary');
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.defaultPrevented || !primary) return;
    const t = e.target;
    if (t instanceof HTMLInputElement && /^(text|number|search|url|email)$/.test(t.type)) { e.preventDefault(); primary.click(); }
  });
  // Close on a backdrop click, but not when a text selection drag ends there.
  let downOnBackdrop = false;
  dlg.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && downOnBackdrop) close(); downOnBackdrop = false; });
  document.body.appendChild(dlg);
  dlg.showModal();
  return { dlg, close };
}

export function confirmDialog(message, { okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    openDialog({
      title: 'Confirm',
      body: h('p', null, message),
      actions: [
        { label: 'Cancel' },
        { label: okLabel, primary: !danger, danger, onClick: () => { result = true; } },
      ],
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog(title, value = '', { label = '', okLabel = 'Save' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input', { type: 'text', class: 'input', value, 'aria-label': label || title });
    openDialog({
      title,
      body: h('label', { class: 'field' }, label ? h('span', null, label) : null, input),
      actions: [
        { label: 'Cancel' },
        { label: okLabel, primary: true, onClick: () => { result = input.value.trim(); } },
      ],
      onClose: () => resolve(result),
    });
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

// ---------- toast ----------

let toastHost = null;
export function toast(message, ms = 2600, action = null) {
  if (!toastHost) {
    // A manual popover lives in the top layer, so a toast raised while a modal dialog is open
    // (an import error, say) is drawn above the dialog instead of underneath it.
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite', popover: 'manual' });
    document.body.appendChild(toastHost);
  }
  let gone = false;
  let timer = 0;
  const dismiss = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    t.classList.add('out');
    setTimeout(() => { t.remove(); if (!toastHost.children.length) { try { toastHost.hidePopover(); } catch { /* not shown */ } } }, 300);
  };
  const arm = (wait) => { clearTimeout(timer); timer = setTimeout(dismiss, wait); };
  const t = h('div', { class: 'toast' },
    h('span', null, message),
    action ? h('button', { type: 'button', class: 'toast-action', onclick: () => { dismiss(); action.onClick(); } }, action.label) : null);
  // Stay while the pointer is over it or focus is inside (an Undo must be reachable).
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('focusin', () => clearTimeout(timer));
  t.addEventListener('mouseleave', () => arm(1500));
  t.addEventListener('focusout', () => arm(1500));
  toastHost.appendChild(t);
  try { toastHost.hidePopover(); } catch { /* not shown */ }
  try { toastHost.showPopover(); } catch { /* popover unsupported */ } // re-show to sit above any dialog opened since
  arm(action ? Math.max(ms, 7000) : ms);
}

// ---------- popover menu ----------

let openMenuEl = null;
let quietBlur = false;

function onOutside(e) {
  if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu();
}

// A click into an iframe never reaches this document, so the window blur is
// the "clicked outside" signal; programmatic focus (focusQuietly) is ignored.
function onWindowBlur() {
  if (!quietBlur) closeMenu();
}

export function focusQuietly(el) {
  quietBlur = true;
  try { el.focus(); } finally { quietBlur = false; }
}

let menuAnchor = null;

// restoreFocus: put focus back on the button that opened the menu (Esc, Tab, a chosen item).
// A click elsewhere or leaving the window must not pull focus back.
export function closeMenu(restoreFocus = false) {
  if (!openMenuEl) return false;
  openMenuEl.remove();
  openMenuEl = null;
  document.removeEventListener('mousedown', onOutside, true);
  window.removeEventListener('blur', onWindowBlur);
  const anchor = menuAnchor;
  menuAnchor = null;
  if (restoreFocus && anchor && anchor.isConnected) focusQuietly(anchor);
  return true;
}

export function popMenu(anchor, items) {
  closeMenu();
  menuAnchor = anchor;
  const menu = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) => (it === '-'
    ? h('div', { class: 'menu-sep', role: 'separator' })
    : h('button', {
      type: 'button',
      role: 'menuitem',
      class: `menu-item${it.danger ? ' danger' : ''}`,
      disabled: !!it.disabled,
      onclick: () => { closeMenu(true); it.onClick(); },
    }, it.icon ? icon(it.icon, 16) : null, h('span', null, it.label)))));
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  menu.style.left = `${Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw))}px`;
  menu.style.top = `${r.bottom + 4 + mh > window.innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4}px`;
  openMenuEl = menu;
  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll('.menu-item:not([disabled])')];
    const at = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu(true); // focus returns to the opener, then Tab moves on
  });
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
  window.addEventListener('blur', onWindowBlur);
  const first = menu.querySelector('.menu-item:not([disabled])');
  if (first) first.focus();
}

// ---------- misc ----------

export function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${Math.max(s, 0)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: s > 31536000 ? 'numeric' : undefined });
}

export function downloadText(filename, text, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch { toast('Copy failed'); }
}
