// Collections logic without any DOM: export formats, import parsing and
// validation, merging, and the write operations. The service worker applies
// every write (background.js) through applyCollectionOp, one at a time, so the
// deck and the in-column save buttons can never overwrite each other. The
// drawer UI lives in collections.js.

import { safeXUrl, cleanHandle } from './columns.js';

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso) {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toISOString().replace('T', ' ').slice(0, 16) : '';
}

// ---------- limits ----------
export const TEXT_MAX = 25000;     // a post can be long (X allows 25,000 characters)
export const NOTE_MAX = 2000;
export const TAG_MAX = 30;
export const TAGS_PER_POST = 20;
export const IMPORT_MAX_BYTES = 8 * 1024 * 1024; // chrome.storage.local holds 10 MB in total
export const IMPORT_MAX_ITEMS = 10000;

// ---------- export ----------

// Heading fields stay on one line so an imported name cannot start new Markdown blocks.
const oneLine = (s) => String(s || '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
const quoted = (s) => String(s || '').split(/\r?\n/).map((l) => `> ${l}`);

export function toMarkdown(items) {
  const out = [`# XDeck collection (${stamp()})`, ''];
  for (const it of items) {
    out.push(`## ${oneLine(it.name || it.handle)} (@${oneLine(it.handle)}) · ${fmtDate(it.time)} UTC`, '');
    out.push(...quoted(it.text));
    if (it.quoteText) { out.push('>', '> Quoting:'); for (const line of quoted(it.quoteText)) out.push(`> ${line}`); }
    out.push('');
    const meta = [`[Open on X](${it.url})`];
    if (it.tags && it.tags.length) meta.push(it.tags.map((t) => `#${t}`).join(' '));
    if (it.metrics) meta.push(`${it.metrics.likes || 0} likes, ${it.metrics.reposts || 0} reposts, ${it.metrics.replies || 0} replies`);
    out.push(meta.join(' · '));
    if (it.note) { out.push('', 'Note:', ...quoted(it.note)); }
    out.push('', '---', '');
  }
  return out.join('\n');
}

// A cell that starts like a formula, or with the guard apostrophe itself, gets one
// leading apostrophe; unguard() removes exactly that on import (symmetric).
const GUARDED = /^['=+\-@\t\r]/;

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (GUARDED.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS = ['id', 'url', 'handle', 'name', 'time', 'text', 'quoteText', 'tags', 'note', 'likes', 'reposts', 'replies', 'savedAt', 'source', 'hasMedia', 'links'];

export function toCsv(items) {
  const rows = [CSV_COLUMNS.join(',')];
  for (const it of items) {
    const m = it.metrics || {};
    rows.push([
      it.id, it.url, it.handle, it.name, it.time, it.text, it.quoteText,
      cleanTags(it.tags).join(' '), it.note, m.likes, m.reposts, m.replies, it.savedAt, it.source,
      it.hasMedia ? 'true' : 'false', (it.links || []).join(' '),
    ].map(csvCell).join(','));
  }
  return rows.join('\r\n');
}

// ---------- import ----------

// RFC 4180-style parser: quoted fields, doubled quotes, CRLF or LF line ends.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Undo csvCell's guard: one leading apostrophe in front of a formula start or another apostrophe.
function unguard(v) {
  return /^'['=+\-@\t\r]/.test(v) ? v.slice(1) : v;
}

// Strings are bounded; control characters other than newline and tab are dropped.
function str(v, max) {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, max);
}

function isoOr(v, fallback) {
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

function count(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// One rule for tags everywhere (the tag box, JSON import, CSV import): no spaces,
// commas or leading #; at most TAG_MAX characters.
export function normalizeTag(t) {
  return String(t).trim().replace(/^#+/, '').replace(/[\s,#]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, TAG_MAX);
}

export function cleanTags(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[\s,]+/);
  const out = [];
  for (const t of list) {
    const tag = normalizeTag(t);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= TAGS_PER_POST) break;
  }
  return out;
}

// One saved post from untrusted input, or null when it has no usable post id.
// `cut` is set on the result when a field had to be shortened.
export function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Ids are 64-bit numbers: a JSON number has already lost digits, so the id in the url wins.
  const fromUrl = String(raw.url || '').match(/\/status\/(\d{1,25})/);
  const rawId = typeof raw.id === 'string' ? raw.id.trim() : '';
  const id = /^\d{1,25}$/.test(rawId) ? rawId : fromUrl ? fromUrl[1] : '';
  if (!id) return null;
  const handle = /^\w{1,15}$/.test(cleanHandle(raw.handle)) ? cleanHandle(raw.handle) : '';
  const safe = safeXUrl(raw.url);
  const url = safe && safe.includes(`/status/${id}`) ? safe : `https://x.com/${handle || 'i'}/status/${id}`;
  const m = raw.metrics && typeof raw.metrics === 'object' ? raw.metrics : raw;
  const text = str(raw.text, TEXT_MAX);
  const quoteText = str(raw.quoteText, TEXT_MAX);
  const note = str(raw.note, NOTE_MAX);
  const cut = String(raw.text || '').length > TEXT_MAX || String(raw.quoteText || '').length > TEXT_MAX || String(raw.note || '').length > NOTE_MAX;
  const links = Array.isArray(raw.links) ? raw.links : typeof raw.links === 'string' ? raw.links.split(/\s+/) : [];
  return {
    id,
    url,
    handle,
    name: str(raw.name, 100).replace(/[\r\n]+/g, ' '),
    text,
    quoteText,
    time: isoOr(raw.time, ''),
    links: links.filter((l) => typeof l === 'string' && /^https:\/\//.test(l)).slice(0, 10).map((l) => l.slice(0, 500)),
    hasMedia: raw.hasMedia === true || raw.hasMedia === 'true',
    metrics: { likes: count(m.likes), reposts: count(m.reposts), replies: count(m.replies) },
    savedAt: isoOr(raw.savedAt, new Date().toISOString()),
    tags: cleanTags(raw.tags),
    note,
    source: str(raw.source, 100).replace(/[\r\n]+/g, ' '),
    ...(cut ? { cut: true } : {}),
  };
}

// Returns { items, skipped, cut } or throws with a message for the user.
export function parseCollectionFile(name, text) {
  const body = String(text || '').replace(/^﻿/, '');
  const trimmed = body.trim();
  let raws;
  if (/\.json$/i.test(name) || /^[[{]/.test(trimmed)) {
    let data;
    try { data = JSON.parse(trimmed); } catch { throw new Error('That JSON file could not be read.'); }
    raws = Array.isArray(data) ? data : data && (data.collections || data.items);
    if (!Array.isArray(raws)) throw new Error('That JSON file has no list of saved posts.');
  } else if (/\.csv$/i.test(name) || /^"?id"?,/.test(trimmed)) {
    const rows = parseCsv(body).filter((r) => r.some((c) => c !== ''));
    const header = (rows.shift() || []).map((c) => c.trim());
    if (!header.includes('id') && !header.includes('url')) throw new Error('That CSV file has no id or url column.');
    raws = rows.map((r) => Object.fromEntries(header.map((k, i) => [k, unguard(r[i] == null ? '' : r[i])])));
  } else {
    throw new Error('Use a JSON or CSV file exported from XDeck Collections.');
  }
  if (raws.length > IMPORT_MAX_ITEMS) throw new Error(`That file has more than ${IMPORT_MAX_ITEMS.toLocaleString('en-US')} posts.`);
  const items = [];
  let skipped = 0;
  let cut = 0;
  for (const r of raws) {
    const it = sanitizeItem(r);
    if (!it) { skipped++; continue; }
    if (it.cut) { cut++; delete it.cut; }
    items.push(it);
  }
  return { items, skipped, cut };
}

// Adds new posts and merges ones already saved (tags combined, an empty note
// filled in); nothing already saved is overwritten. Newest saved first.
export function mergeCollections(existing, incoming) {
  const byId = new Map(existing.map((it) => [it.id, { ...it }]));
  let added = 0;
  let merged = 0;
  for (const it of incoming) {
    const cur = byId.get(it.id);
    if (!cur) { byId.set(it.id, it); added++; continue; }
    const tags = cleanTags([...(cur.tags || []), ...(it.tags || [])]);
    const note = cur.note || it.note || '';
    if (tags.length !== (cur.tags || []).length || note !== (cur.note || '')) merged++;
    byId.set(it.id, { ...cur, tags, note });
  }
  const items = [...byId.values()].sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
  return { items, added, merged };
}

// ---------- write operations (run by the service worker, one at a time) ----------
// op = { kind: 'toggle', item } | { kind: 'remove', id } | { kind: 'patch', id, tags?, note? }
//    | { kind: 'merge', items } | { kind: 'clear' }
// Returns { list, result } or throws an Error for an invalid operation.
export function applyCollectionOp(list, op) {
  if (!op || typeof op !== 'object') throw new Error('invalid operation');
  switch (op.kind) {
    case 'toggle': {
      const item = sanitizeItem(op.item);
      if (!item) throw new Error('that post has no usable id');
      const i = list.findIndex((c) => c.id === item.id);
      if (i >= 0) return { list: list.filter((c) => c.id !== item.id), result: { saved: false } };
      delete item.cut;
      return { list: [item, ...list], result: { saved: true } };
    }
    case 'remove':
      return { list: list.filter((c) => c.id !== String(op.id)), result: {} };
    case 'patch': {
      let found = false;
      const next = list.map((c) => {
        if (c.id !== String(op.id)) return c;
        found = true;
        const out = { ...c };
        if (op.tags !== undefined) out.tags = cleanTags(op.tags);
        if (op.note !== undefined) out.note = str(op.note, NOTE_MAX);
        return out;
      });
      return { list: next, result: { found } };
    }
    case 'merge': {
      const incoming = (Array.isArray(op.items) ? op.items : []).map(sanitizeItem).filter(Boolean);
      incoming.forEach((it) => { delete it.cut; });
      const { items, added, merged } = mergeCollections(list, incoming);
      return { list: items, result: { added, merged } };
    }
    case 'clear':
      return { list: [], result: {} };
    default:
      throw new Error('unknown operation');
  }
}
