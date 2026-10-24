// Unit tests for collections import (src/collections.js), no browser needed.
// Run: npm run test:collections

import { toCsv, toMarkdown, parseCsv, parseCollectionFile, sanitizeItem, mergeCollections, applyCollectionOp } from '../src/collections.js';
import { normalizeTag, cleanTags, TEXT_MAX, NOTE_MAX, IMPORT_MAX_BYTES, IMPORT_MAX_ITEMS } from '../src/collections-core.js';

let failed = 0;
let total = 0;
const eq = (name, got, want) => {
  total++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const throws = (name, fn, pattern) => {
  total++;
  let msg = '';
  try { fn(); } catch (e) { msg = e.message; }
  const ok = pattern.test(msg);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  message=${JSON.stringify(msg)}`}`);
};

const items = [
  {
    id: '9001', url: 'https://x.com/example_news/status/9001', handle: 'example_news', name: 'Example "News" Desk',
    text: 'Line one, with a comma\nline two', quoteText: '', time: '2026-10-21T10:00:00.000Z', links: [], hasMedia: false,
    metrics: { likes: 1840, reposts: 412, replies: 96 }, savedAt: '2026-10-21T11:00:00.000Z', tags: ['transit', 'city'], note: 'Follow up', source: 'Home',
  },
  {
    id: '9002', url: 'https://x.com/sample_labs/status/9002', handle: 'sample_labs', name: 'Sample Labs',
    text: '=1+1 looks like a formula', quoteText: 'quoted', time: '2026-10-21T09:00:00.000Z', links: ['https://t.co/abc'], hasMedia: true,
    metrics: { likes: 5, reposts: 0, replies: 1 }, savedAt: '2026-10-21T12:00:00.000Z', tags: [], note: '', source: 'Search',
  },
];

// JSON round trip
const j = parseCollectionFile('xdeck-collection.json', JSON.stringify(items, null, 2));
eq('json: all items imported', j.items.map((i) => i.id), ['9001', '9002']);
eq('json: fields survive the round trip', [j.items[0].text, j.items[0].tags, j.items[0].note, j.items[1].links, j.items[1].hasMedia], [items[0].text, ['transit', 'city'], 'Follow up', ['https://t.co/abc'], true]);
eq('json: {collections: [...]} wrapper accepted', parseCollectionFile('a.json', JSON.stringify({ collections: items })).items.length, 2);

// CSV round trip through the real exporter (BOM, quotes, newlines, formula guard)
const csv = `﻿${toCsv(items)}`;
const c = parseCollectionFile('xdeck-collection.csv', csv);
eq('csv: all items imported', c.items.map((i) => i.id), ['9001', '9002']);
eq('csv: quotes, commas and newlines survive', [c.items[0].name, c.items[0].text], ['Example "News" Desk', 'Line one, with a comma\nline two']);
eq('csv: formula guard removed again', c.items[1].text, '=1+1 looks like a formula');
eq('csv: tags and counts restored', [c.items[0].tags, c.items[0].metrics], [['transit', 'city'], { likes: 1840, reposts: 412, replies: 96 }]);
eq('csv parser: quoted fields and CRLF', parseCsv('a,"b,c","d""e"\r\n1,2,3'), [['a', 'b,c', 'd"e'], ['1', '2', '3']]);

// validation of untrusted input
eq('sanitize: id taken from the url when missing', sanitizeItem({ url: 'https://x.com/a/status/123' }).id, '123');
eq('sanitize: no id anywhere is skipped', sanitizeItem({ text: 'hello' }), null);
eq('sanitize: non-x.com url replaced with a safe x.com url', sanitizeItem({ id: '77', handle: 'bob', url: 'javascript:alert(1)' }).url, 'https://x.com/bob/status/77');
eq('sanitize: url for another post is not trusted', sanitizeItem({ id: '77', url: 'https://x.com/bob/status/99' }).url, 'https://x.com/i/status/77');
eq('sanitize: bad handle dropped', sanitizeItem({ id: '1', handle: '<script>' }).handle, '');
eq('sanitize: tags cleaned and capped', sanitizeItem({ id: '1', tags: ['#AI News', 'ai-news', 'x'.repeat(50)] }).tags, ['ai-news', 'x'.repeat(30)]);
eq('sanitize: negative and junk counts become 0', sanitizeItem({ id: '1', metrics: { likes: -5, reposts: 'lots', replies: 3.7 } }).metrics, { likes: 0, reposts: 0, replies: 3 });
eq('sanitize: only https links kept', sanitizeItem({ id: '1', links: ['https://t.co/a', 'javascript:x', 5] }).links, ['https://t.co/a']);
eq('sanitize: a long post (X allows 25,000 characters) is kept whole; beyond that it is cut and flagged', [sanitizeItem({ id: '1', text: 'a'.repeat(9000) }).text.length, sanitizeItem({ id: '1', text: 'a'.repeat(30000) }).text.length, sanitizeItem({ id: '1', text: 'a'.repeat(30000) }).cut], [9000, TEXT_MAX, true]);
const mixed = parseCollectionFile('m.json', JSON.stringify([{ id: '1' }, { text: 'no id' }, null, 'junk']));
eq('parse: invalid rows counted as skipped', [mixed.items.length, mixed.skipped], [1, 3]);

throws('reject: unreadable JSON', () => parseCollectionFile('a.json', '{oops'), /could not be read/);
throws('reject: JSON without a list', () => parseCollectionFile('a.json', '{"x":1}'), /no list/);
throws('reject: CSV without id or url', () => parseCollectionFile('a.csv', 'foo,bar\n1,2'), /no id or url/);
throws('reject: Markdown or other files', () => parseCollectionFile('a.md', '# XDeck collection'), /JSON or CSV/);

// merge
const existing = [{ ...items[0], tags: ['transit'], note: '' }];
const incoming = [
  { ...items[0], tags: ['city'], note: 'From file', savedAt: '2026-10-20T00:00:00.000Z' },
  sanitizeItem({ id: '9003', handle: 'demo', savedAt: '2026-10-22T00:00:00.000Z' }),
];
const r = mergeCollections(existing, incoming);
eq('merge: counts', [r.added, r.merged], [1, 1]);
eq('merge: tags combined, empty note filled, saved time kept', [r.items.find((i) => i.id === '9001').tags, r.items.find((i) => i.id === '9001').note, r.items.find((i) => i.id === '9001').savedAt], [['transit', 'city'], 'From file', items[0].savedAt]);
eq('merge: newest saved first', r.items.map((i) => i.id), ['9003', '9001']);
const again = mergeCollections(r.items, incoming);
eq('merge: importing the same file twice changes nothing', [again.added, again.merged, again.items.length], [0, 0, 2]);
const keepNote = mergeCollections([{ ...items[0] }], [{ ...items[0], note: 'other' }]);
eq('merge: an existing note is never overwritten', keepNote.items[0].note, 'Follow up');

// ---- findings fixed in 0.1.5 ----
const apos = [{ ...base0(), text: "'@bob said hi'" }, { ...base0(), id: '2', url: 'https://x.com/a/status/2', text: "''quoted''" }, { ...base0(), id: '3', url: 'https://x.com/a/status/3', text: "=1+1" }, { ...base0(), id: '4', url: 'https://x.com/a/status/4', text: "it's fine" }];
function base0() { return { id: '1', url: 'https://x.com/a/status/1', handle: 'a', name: 'A', savedAt: '2026-10-01T00:00:00Z' }; }
eq('csv: text that really starts with an apostrophe or a formula character survives a round trip', parseCollectionFile('a.csv', toCsv(apos)).items.map((i) => i.text), ["'@bob said hi'", "''quoted''", '=1+1', "it's fine"]);
eq('csv: media flag and links round trip', (() => { const it = parseCollectionFile('a.csv', toCsv([{ ...base0(), hasMedia: true, links: ['https://t.co/x', 'https://t.co/y'] }])).items[0]; return [it.hasMedia, it.links]; })(), [true, ['https://t.co/x', 'https://t.co/y']]);
eq('tags: one rule for the tag box, JSON and CSV (commas and spaces become -)', [normalizeTag('#A,B c'), cleanTags(['a,b']), parseCollectionFile('a.csv', toCsv([{ ...base0(), tags: ['a,b'] }])).items[0].tags, parseCollectionFile('a.json', JSON.stringify([{ ...base0(), tags: ['a,b'] }])).items[0].tags], ['a-b-c', ['a-b'], ['a-b'], ['a-b']]);
const evil = parseCollectionFile('a.json', JSON.stringify([{ ...base0(), name: 'Eve\n# Injected\n[click](https://evil.example)', note: 'line one\n# not a heading\n[x](https://evil.example)' }])).items;
const md = toMarkdown(evil);
eq('markdown: an imported name or note cannot start new blocks', [/^# Injected$/m.test(md), /^## .*Eve # Injected/m.test(md), /^# not a heading$/m.test(md), /^> # not a heading$/m.test(md)], [false, true, false, true]);
eq('import: a number id loses digits, so the id in the url is used', (() => { const it = parseCollectionFile('a.json', '[{"id": 1849012345678901234, "url": "https://x.com/bob/status/1849012345678901234"}]').items[0]; return [it.id, it.url]; })(), ['1849012345678901234', 'https://x.com/bob/status/1849012345678901234']);
eq('import: a number id and no usable url is skipped', parseCollectionFile('a.json', '[{"id": 1849012345678901234}]').skipped, 1);
eq('import: shortened items are counted', parseCollectionFile('a.json', JSON.stringify([{ ...base0(), note: 'n'.repeat(NOTE_MAX + 5) }])).cut, 1);
eq('import: limits fit the 10 MB storage quota', [IMPORT_MAX_BYTES <= 8 * 1048576, IMPORT_MAX_ITEMS], [true, 10000]);

// ---- write operations (applied by the service worker) ----
const mk = (id, extra = {}) => ({ id, url: `https://x.com/a/status/${id}`, handle: 'a', name: 'A', text: `post ${id}`, tags: [], note: '', savedAt: `2026-10-0${id}T00:00:00Z`, ...extra });
const l0 = [mk('1'), mk('2')];
const tg = applyCollectionOp(l0, { kind: 'toggle', item: mk('3') });
eq('op toggle: a new post is added first', [tg.list.map((i) => i.id), tg.result], [['3', '1', '2'], { saved: true }]);
const tg2 = applyCollectionOp(tg.list, { kind: 'toggle', item: mk('3') });
eq('op toggle: toggling a saved post removes it', [tg2.list.map((i) => i.id), tg2.result], [['1', '2'], { saved: false }]);
eq('op toggle: a post with no usable id is refused', (() => { try { applyCollectionOp(l0, { kind: 'toggle', item: { text: 'x' } }); return ''; } catch (e) { return e.message; } })(), 'that post has no usable id');
const pt = applyCollectionOp(l0, { kind: 'patch', id: '2', tags: ['A b', '#c'], note: 'n' });
eq('op patch: tags are normalised, note set, other posts untouched', [pt.list.find((i) => i.id === '2').tags, pt.list.find((i) => i.id === '2').note, pt.list.find((i) => i.id === '1').tags, pt.result], [['a-b', 'c'], 'n', [], { found: true }]);
eq('op patch: an unknown id changes nothing', [applyCollectionOp(l0, { kind: 'patch', id: '9', note: 'x' }).result, applyCollectionOp(l0, { kind: 'patch', id: '9', note: 'x' }).list.length], [{ found: false }, 2]);
eq('op remove and clear', [applyCollectionOp(l0, { kind: 'remove', id: '1' }).list.map((i) => i.id), applyCollectionOp(l0, { kind: 'clear' }).list], [['2'], []]);
const mg = applyCollectionOp(l0, { kind: 'merge', items: [mk('2', { tags: ['x'] }), mk('5'), { text: 'junk' }] });
eq('op merge: sanitises, merges and counts', [mg.result, mg.list.map((i) => i.id).sort()], [{ added: 1, merged: 1 }, ['1', '2', '5']]);
eq('op: unknown kinds and non-objects are refused', ['nope', null, 7].map((k) => { try { applyCollectionOp(l0, k && typeof k === 'object' ? k : { kind: k }); return 'ok'; } catch { return 'refused'; } }), ['refused', 'refused', 'refused']);
// Applying operations one after another (what the service worker queue does) never loses a change.
let live = [];
for (const op of [{ kind: 'toggle', item: mk('1') }, { kind: 'patch', id: '1', note: 'keep me' }, { kind: 'merge', items: [mk('2'), mk('3')] }, { kind: 'toggle', item: mk('4') }]) live = applyCollectionOp(live, op).list;
eq('ops in sequence keep every change', [live.map((i) => i.id).sort(), live.find((i) => i.id === '1').note], [['1', '2', '3', '4'], 'keep me']);

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
