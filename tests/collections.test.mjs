// Unit tests for collections import (src/collections.js), no browser needed.
// Run: npm run test:collections

import { toCsv, parseCsv, parseCollectionFile, sanitizeItem, mergeCollections } from '../src/collections.js';

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
eq('sanitize: long text capped', sanitizeItem({ id: '1', text: 'a'.repeat(9000) }).text.length, 5000);
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

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
