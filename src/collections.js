// Collections drawer: posts saved with the in-column bookmark-plus button.
// Tags, notes, search, Markdown / CSV / JSON export, and JSON / CSV import.
// The data logic (formats, validation, merging, write operations) lives in
// collections-core.js; every write goes through the service worker.

import { h, icon, iconButton, clear, relTime, downloadText, copyText, confirmDialog, toast } from './dom.js';
import { getCollections, collectionOp } from './store.js';
import { safeXUrl } from './columns.js';
import {
  toMarkdown, toCsv, parseCollectionFile, normalizeTag, IMPORT_MAX_BYTES, NOTE_MAX, TAGS_PER_POST,
} from './collections-core.js';

export {
  toMarkdown, toCsv, parseCsv, parseCollectionFile, sanitizeItem, mergeCollections, applyCollectionOp,
  IMPORT_MAX_BYTES, IMPORT_MAX_ITEMS,
} from './collections-core.js';

const PAGE = 100; // posts rendered at a time

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

export class CollectionsDrawer {
  constructor({ el, openReader }) {
    this.el = el;
    this.openReader = openReader;
    this.items = [];
    this.query = '';
    this.tag = '';
    this.limit = PAGE;
    this.isOpen = false;
    this.opener = null;
    this.refocus = null;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.collections) return;
      this.items = changes.collections.newValue || [];
      if (this.isOpen) this.renderListUnlessEditing();
    });
  }

  async open() {
    this.items = await getCollections();
    this.isOpen = true;
    this.opener = document.activeElement;
    this.limit = PAGE;
    this.el.hidden = false;
    this.render();
    if (this.searchEl) this.searchEl.focus(); // the drawer is last in the DOM; keyboard users need to land in it
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.hidden = true;
    const back = this.opener;
    this.opener = null;
    if (back && back.isConnected && typeof back.focus === 'function') back.focus();
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }

  // Run a write through the service worker; shows the reason when it fails.
  async write(op, failure = 'Could not save the change') {
    try {
      const result = await collectionOp(op);
      // Show the new state now: the storage event can be held back while a box in the list has focus.
      this.items = await getCollections();
      if (this.isOpen) this.renderList();
      return result;
    } catch (err) {
      toast(`${failure}: ${err && err.message ? err.message : err}`, 6000);
      return null;
    }
  }

  render() {
    clear(this.el);
    const file = h('input', { type: 'file', accept: '.json,.csv,application/json,text/csv', hidden: true, class: 'coll-import', 'aria-label': 'Import collection file' });
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (f) this.importFile(f);
    });
    this.countEl = h('span', { class: 'muted' });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search saved posts, @handles, #tags', value: this.query, 'aria-label': 'Search collections' });
    let searchTimer = 0;
    search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { this.query = search.value; this.limit = PAGE; this.renderList(); }, 150);
    });
    this.searchEl = search;
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
          h('button', { type: 'button', class: 'btn btn-sm', title: 'Import a JSON or CSV file exported from XDeck Collections', onclick: () => file.click() }, icon('upload', 14), ' Import'),
          h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: () => this.clearAll() }, 'Clear'),
          file),
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
    const tags = [...new Set(this.items.flatMap((it) => it.tags || []))].sort();
    if (this.tag && !tags.includes(this.tag)) this.tag = ''; // the tag was removed: do not leave an invisible filter on
    const items = this.filtered();
    this.countEl.textContent = `${items.length} of ${this.items.length} saved`;
    clear(this.tagsEl);
    if (tags.length) {
      this.tagsEl.append(h('button', { type: 'button', class: `chip${this.tag ? '' : ' on'}`, onclick: () => { this.tag = ''; this.limit = PAGE; this.renderList(); } }, 'All'));
      for (const t of tags) {
        this.tagsEl.append(h('button', { type: 'button', class: `chip${this.tag === t ? ' on' : ''}`, onclick: () => { this.tag = this.tag === t ? '' : t; this.limit = PAGE; this.renderList(); } }, `#${t}`));
      }
    }
    clear(this.listEl);
    if (!items.length) {
      this.listEl.append(h('div', { class: 'coll-empty' },
        h('p', null, this.items.length ? 'No saved posts match.' : 'Nothing saved yet.'),
        h('p', { class: 'muted' }, 'Use the bookmark-plus button in any post\'s action bar to save it here.')));
    } else {
      for (const it of items.slice(0, this.limit)) this.listEl.append(this.itemEl(it));
      if (items.length > this.limit) {
        this.listEl.append(h('div', { class: 'coll-more' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { this.limit += PAGE; this.renderList(); } }, `Show ${Math.min(PAGE, items.length - this.limit)} more (${items.length - this.limit} not shown)`)));
      }
    }
    this.applyRefocus();
  }

  // After a re-render the focused control is gone; put focus on its replacement.
  applyRefocus() {
    const r = this.refocus;
    this.refocus = null;
    if (!r || !this.isOpen) return;
    let target = null;
    if (r.kind === 'tag') {
      const item = [...this.listEl.querySelectorAll('.coll-item')].find((n) => n.dataset.id === r.id);
      target = item && item.querySelector('.tag-input');
    }
    (target || this.searchEl).focus();
  }

  itemEl(it) {
    const url = safeXUrl(it.url) || 'https://x.com/';
    const patch = async (fields, refocus) => {
      this.refocus = refocus || null;
      await this.write({ kind: 'patch', id: it.id, ...fields });
    };
    const tagInput = h('input', { class: 'tag-input', type: 'text', placeholder: '+ tag', 'aria-label': 'Add tag' });
    tagInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      const t = normalizeTag(tagInput.value);
      if (!t) return;
      if ((it.tags || []).length >= TAGS_PER_POST) { toast(`A post can have ${TAGS_PER_POST} tags at most`); return; }
      patch({ tags: [...new Set([...(it.tags || []), t])] }, { kind: 'tag', id: it.id });
    });
    const note = h('textarea', { class: 'input note', rows: 2, placeholder: 'Note', maxlength: String(NOTE_MAX) });
    note.value = it.note || '';
    note.addEventListener('change', () => patch({ note: note.value.trim() }));
    return h('article', { class: 'coll-item', dataset: { id: it.id } },
      h('div', { class: 'coll-meta' },
        h('strong', null, it.name || it.handle),
        h('span', { class: 'muted' }, ` @${it.handle} · ${relTime(it.time)}`),
        it.source ? h('span', { class: 'muted coll-source' }, ` · from ${it.source}`) : null),
      h('div', { class: 'coll-text' }, it.text || (it.hasMedia ? '[media]' : '')),
      it.quoteText ? h('div', { class: 'coll-quote' }, it.quoteText) : null,
      h('div', { class: 'coll-tags' },
        (it.tags || []).map((t) => h('span', { class: 'tag' }, `#${t}`,
          h('button', { type: 'button', class: 'tag-x', title: `Remove #${t}`, 'aria-label': `Remove tag ${t}`, onclick: () => patch({ tags: (it.tags || []).filter((y) => y !== t) }, { kind: 'tag', id: it.id }) }, '×'))),
        tagInput),
      note,
      h('div', { class: 'coll-actions' },
        iconButton('panel', 'Open in reading pane', () => { this.close(); this.openReader(url); }, { size: 16 }),
        h('a', { class: 'icon-btn', href: url, target: '_blank', rel: 'noopener', title: 'Open in new tab', 'aria-label': 'Open in new tab' }, icon('external', 16)),
        iconButton('copy', 'Copy link', () => copyText(url), { size: 16 }),
        iconButton('list', 'Copy as Markdown', () => copyText(toMarkdown([it])), { size: 16 }),
        iconButton('trash', 'Remove from collection', () => { this.refocus = { kind: 'search' }; this.write({ kind: 'remove', id: it.id }); }, { size: 16, class: 'danger' })));
  }

  export(kind) {
    const items = this.filtered();
    if (!items.length) { toast('Nothing to export'); return; }
    if (kind === 'md') downloadText(`xdeck-collection-${stamp()}.md`, toMarkdown(items), 'text/markdown');
    else if (kind === 'csv') downloadText(`xdeck-collection-${stamp()}.csv`, `\ufeff${toCsv(items)}`, 'text/csv');
    else downloadText(`xdeck-collection-${stamp()}.json`, JSON.stringify(items, null, 2), 'application/json');
  }

  async importFile(file) {
    if (file.size > IMPORT_MAX_BYTES) { toast(`That file is too large to import (${Math.round(IMPORT_MAX_BYTES / 1048576)} MB maximum; XDeck's storage holds 10 MB)`, 6000); return; }
    let parsed;
    try {
      parsed = parseCollectionFile(file.name, await file.text());
    } catch (err) {
      toast(`Import failed: ${err.message}`, 6000);
      return;
    }
    if (!parsed.items.length) { toast('No saved posts found in that file', 5000); return; }
    const result = await this.write({ kind: 'merge', items: parsed.items }, 'Import failed');
    if (!result) return;
    const parts = [`${result.added} new`];
    if (result.merged) parts.push(`${result.merged} merged`);
    const same = parsed.items.length - result.added - result.merged;
    if (same > 0) parts.push(`${same} already saved`);
    if (parsed.skipped) parts.push(`${parsed.skipped} skipped (no post id)`);
    if (parsed.cut) parts.push(`${parsed.cut} shortened (over the length limits)`);
    toast(`Imported: ${parts.join(', ')}`, 5000);
  }

  async clearAll() {
    if (!this.items.length) return;
    if (!(await confirmDialog(`Remove all ${this.items.length} saved posts?`, { okLabel: 'Remove all', danger: true }))) return;
    if (await this.write({ kind: 'clear' }, 'Could not clear')) toast('Collection cleared');
  }
}
