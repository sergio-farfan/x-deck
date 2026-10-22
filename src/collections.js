// Collections drawer: posts saved with the in-column bookmark-plus button.
// Tags, notes, search, and Markdown / CSV / JSON export.

import { h, icon, iconButton, clear, relTime, downloadText, copyText, confirmDialog, toast } from './dom.js';
import { getCollections, updateCollections } from './store.js';
import { safeXUrl } from './columns.js';

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString().replace('T', ' ').slice(0, 16) : '';
}

export function toMarkdown(items) {
  const out = [`# XDeck collection (${stamp()})`, ''];
  for (const it of items) {
    out.push(`## ${it.name || it.handle} (@${it.handle}) · ${fmtDate(it.time)} UTC`, '');
    for (const line of String(it.text || '').split('\n')) out.push(`> ${line}`);
    if (it.quoteText) { out.push('>', '> Quoting:'); for (const line of it.quoteText.split('\n')) out.push(`> > ${line}`); }
    out.push('');
    const meta = [`[Open on X](${it.url})`];
    if (it.tags && it.tags.length) meta.push(it.tags.map((t) => `#${t}`).join(' '));
    if (it.metrics) meta.push(`${it.metrics.likes || 0} likes, ${it.metrics.reposts || 0} reposts, ${it.metrics.replies || 0} replies`);
    out.push(meta.join(' · '));
    if (it.note) out.push('', `Note: ${it.note}`);
    out.push('', '---', '');
  }
  return out.join('\n');
}

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // keep spreadsheets from evaluating cells as formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(items) {
  const cols = ['id', 'url', 'handle', 'name', 'time', 'text', 'quoteText', 'tags', 'note', 'likes', 'reposts', 'replies', 'savedAt', 'source'];
  const rows = [cols.join(',')];
  for (const it of items) {
    const m = it.metrics || {};
    rows.push([
      it.id, it.url, it.handle, it.name, it.time, it.text, it.quoteText,
      (it.tags || []).join(' '), it.note, m.likes, m.reposts, m.replies, it.savedAt, it.source,
    ].map(csvCell).join(','));
  }
  return rows.join('\r\n');
}

export class CollectionsDrawer {
  constructor({ el, openReader }) {
    this.el = el;
    this.openReader = openReader;
    this.items = [];
    this.query = '';
    this.tag = '';
    this.isOpen = false;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.collections) return;
      this.items = changes.collections.newValue || [];
      if (this.isOpen) this.renderListUnlessEditing();
    });
  }

  async open() {
    this.items = await getCollections();
    this.isOpen = true;
    this.el.hidden = false;
    this.render();
  }

  close() {
    this.isOpen = false;
    this.el.hidden = true;
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }

  render() {
    clear(this.el);
    this.countEl = h('span', { class: 'muted' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search saved posts, @handles, #tags', value: this.query, 'aria-label': 'Search collections' });
    search.addEventListener('input', () => { this.query = search.value; this.renderList(); });
    this.tagsEl = h('div', { class: 'chips tag-filter' });
    this.listEl = h('div', { class: 'coll-list' });
    this.listEl.addEventListener('focusout', () => setTimeout(() => {
      if (this.dirty && !this.listEl.contains(document.activeElement)) { this.dirty = false; this.renderList(); }
    }, 0));
    this.el.append(
      h('header', { class: 'drawer-head' },
        h('div', null, h('h2', null, 'Collections'), this.countEl),
        iconButton('close', 'Close', () => this.close())),
      h('div', { class: 'drawer-tools' },
        search,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => this.export('md') }, icon('download', 14), ' Markdown'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => this.export('csv') }, icon('download', 14), ' CSV'),
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => this.export('json') }, icon('download', 14), ' JSON'),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => this.clearAll() }, 'Clear')),
        this.tagsEl),
      this.listEl);
    this.renderList();
  }

  // Re-rendering replaces the inputs, so wait while the user is typing in one.
  renderListUnlessEditing() {
    const ae = document.activeElement;
    if (this.listEl && this.listEl.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) { this.dirty = true; return; }
    this.renderList();
  }

  filtered() {
    const q = this.query.trim().toLowerCase();
    return this.items.filter((it) => {
      if (this.tag && !(it.tags || []).includes(this.tag)) return false;
      if (!q) return true;
      const hay = `${it.text}\n${it.quoteText || ''}\n${it.name}\n@${it.handle}\n${(it.tags || []).map((t) => `#${t}`).join(' ')}\n${it.note || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  renderList() {
    if (!this.listEl) return;
    this.dirty = false;
    const items = this.filtered();
    this.countEl.textContent = `${items.length} of ${this.items.length} saved`;
    const tags = [...new Set(this.items.flatMap((it) => it.tags || []))].sort();
    clear(this.tagsEl);
    if (tags.length) {
      this.tagsEl.append(h('button', { type: 'button', class: `chip${this.tag ? '' : ' on'}`, onclick: () => { this.tag = ''; this.renderList(); } }, 'All'));
      for (const t of tags) {
        this.tagsEl.append(h('button', { type: 'button', class: `chip${this.tag === t ? ' on' : ''}`, onclick: () => { this.tag = this.tag === t ? '' : t; this.renderList(); } }, `#${t}`));
      }
    }
    clear(this.listEl);
    if (!items.length) {
      this.listEl.append(h('div', { class: 'coll-empty' },
        h('p', null, this.items.length ? 'No saved posts match.' : 'Nothing saved yet.'),
        h('p', { class: 'muted' }, 'Use the bookmark-plus button in any post\'s action bar to save it here.')));
      return;
    }
    for (const it of items) this.listEl.append(this.itemEl(it));
  }

  itemEl(it) {
    const url = safeXUrl(it.url) || 'https://x.com/';
    const update = (fn) => updateCollections((list) => {
      const x = list.find((i) => i.id === it.id);
      if (x) fn(x);
      return list;
    });
    const tagInput = h('input', { class: 'tag-input', type: 'text', placeholder: '+ tag', 'aria-label': 'Add tag' });
    tagInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const t = tagInput.value.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase().slice(0, 30);
      if (t) update((x) => { x.tags = [...new Set([...(x.tags || []), t])]; }).then(() => this.renderList());
    });
    const note = h('textarea', { class: 'input note', rows: 2, placeholder: 'Note' });
    note.value = it.note || '';
    note.addEventListener('change', () => update((x) => { x.note = note.value.trim(); }));
    return h('article', { class: 'coll-item' },
      h('div', { class: 'coll-meta' },
        h('strong', null, it.name || it.handle),
        h('span', { class: 'muted' }, ` @${it.handle} · ${relTime(it.time)}`),
        it.source ? h('span', { class: 'muted coll-source' }, ` · from ${it.source}`) : null),
      h('div', { class: 'coll-text' }, it.text || (it.hasMedia ? '[media]' : '')),
      it.quoteText ? h('div', { class: 'coll-quote' }, it.quoteText) : null,
      h('div', { class: 'coll-tags' },
        (it.tags || []).map((t) => h('span', { class: 'tag' }, `#${t}`,
          h('button', { type: 'button', class: 'tag-x', title: `Remove #${t}`, 'aria-label': `Remove tag ${t}`, onclick: () => update((x) => { x.tags = (x.tags || []).filter((y) => y !== t); }) }, '×'))),
        tagInput),
      note,
      h('div', { class: 'coll-actions' },
        iconButton('panel', 'Open in reading pane', () => this.openReader(url), { size: 16 }),
        h('a', { class: 'icon-btn', href: url, target: '_blank', rel: 'noopener', title: 'Open in new tab', 'aria-label': 'Open in new tab' }, icon('external', 16)),
        iconButton('copy', 'Copy link', () => copyText(url), { size: 16 }),
        iconButton('list', 'Copy as Markdown', () => copyText(toMarkdown([it])), { size: 16 }),
        iconButton('trash', 'Remove from collection', () => updateCollections((list) => list.filter((x) => x.id !== it.id)), { size: 16, class: 'danger' })));
  }

  export(kind) {
    const items = this.filtered();
    if (!items.length) { toast('Nothing to export'); return; }
    if (kind === 'md') downloadText(`xdeck-collection-${stamp()}.md`, toMarkdown(items), 'text/markdown');
    else if (kind === 'csv') downloadText(`xdeck-collection-${stamp()}.csv`, `﻿${toCsv(items)}`, 'text/csv');
    else downloadText(`xdeck-collection-${stamp()}.json`, JSON.stringify(items, null, 2), 'application/json');
  }

  async clearAll() {
    if (!this.items.length) return;
    if (!(await confirmDialog(`Remove all ${this.items.length} saved posts?`, { okLabel: 'Remove all', danger: true }))) return;
    await updateCollections(() => []);
    toast('Collection cleared');
  }
}
