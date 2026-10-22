// Unit tests for content/core.js against the X markup fixture.
// Run: npm run test:core   (needs `npm install` and `npx playwright install chromium`)

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${root}/tests/fixtures/x-timeline.html`);
await page.addScriptTag({ path: path.join(root, 'content/core.js') });

const results = await page.evaluate(() => {
  const C = globalThis.XDeckCore;
  const arts = [...document.querySelectorAll(C.SEL.article)];
  const [a1, a2, a3, a4] = arts;
  const p1 = C.parseArticle(a1);
  const p2 = C.parseArticle(a2);
  const p4 = C.parseArticle(a4);
  const ev = (post, filters, mute) => C.evaluate(post, C.compileFilters(filters, mute || ''));
  const t = [];
  const eq = (name, got, want) => t.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

  eq('num 1.2K', C.num('1.2K'), 1200);
  eq('num 3,456', C.num('3,456'), 3456);
  eq('num es 1,2 mil', C.num('1,2 mil'), 1200);
  eq('num de 1.234', C.num('1.234'), 1234);
  eq('num de 12 Mio.', C.num('12 Mio.'), 12000000);
  eq('num ja 1.5万', C.num('1.5\u4e07'), 15000);
  eq('terms keep /regex/ with commas', C.splitTerms('a, /b{1,3}/i, c'), ['a', '/b{1,3}/i', 'c']);
  eq('p1 id', p1.id, '1001');
  eq('p1 handle', p1.handle, 'bob');
  eq('p1 name', p1.name, 'Bob Builder');
  eq('p1 text keeps emoji', p1.text.includes('\u{1F680}'), true);
  eq('p1 verified', p1.verified, true);
  eq('p1 reply', p1.isReply, true);
  eq('p1 media', p1.hasMedia, true);
  eq('p1 links', p1.hasLinks, true);
  eq('p1 quote', p1.isQuote, true);
  eq('p1 quote text', p1.quoteText, 'quoted text here');
  eq('p1 metrics', p1.metrics, { replies: 12, reposts: 34, likes: 1234, bookmarks: 5, views: 9876 });
  eq('p1 lang', p1.lang, 'en');
  eq('p1 not promoted', C.isPromoted(a1), false);
  eq('p2 repost', p2.isRepost, true);
  eq('p2 reposter', p2.reposter, 'alice');
  eq('p2 not reply', p2.isReply, false);
  eq('a3 promoted', C.isPromoted(a3), true);
  const rendering = a4.cloneNode(true);
  rendering.querySelector('time').closest('a').remove();
  eq('post without timestamp is not assumed to be an ad', C.isPromoted(rendering), false);
  eq('p4 lang', p4.lang, 'es');

  eq('keep by default', ev(p1, {}), null);
  eq('exclude word', ev(p2, { exclude: 'spoiler' }), 'excluded word');
  eq('global mute', ev(p2, {}, 'finale'), 'muted');
  eq('include missing', ev(p4, { include: 'launch' }), 'missing keyword');
  eq('include present', ev(p1, { include: 'launch, other' }), null);
  eq('regex include', ev(p1, { include: '/wor.d/' }), null);
  eq('word boundary: AI not in said', ev(p4, { exclude: 'AI' }), null);
  eq('exclude user', ev(p1, { excludeUsers: '@BOB' }), 'excluded user');
  eq('exclude reposter', ev(p2, { excludeUsers: 'alice' }), 'excluded user');
  eq('hide reposts', ev(p2, { hideReposts: true }), 'repost');
  eq('hide replies', ev(p1, { hideReplies: true }), 'reply');
  eq('hide quotes', ev(p1, { hideQuotes: true }), 'quote');
  eq('only media', ev(p4, { onlyMedia: true }), 'no media');
  eq('only verified', ev(p4, { onlyVerified: true }), 'not verified');
  eq('min likes', ev(p1, { minLikes: 2000 }), 'few likes');
  eq('min likes pass', ev(p1, { minLikes: 1000 }), null);
  eq('language', ev(p1, { lang: 'es' }), 'language');
  eq('language pass', ev(p4, { lang: 'en, es' }), null);
  eq('CJK mute word matches inside text', ev({ ...p4, text: '\u6771\u4eac\u3067\u5730\u9707\u304c\u767a\u751f' }, { exclude: '\u5730\u9707' }), 'excluded word');
  const sticky = C.compileFilters({ include: '/hel+o/gy' }, '');
  eq('regex g/y flags do not make matching alternate', [C.evaluate(p1, sticky), C.evaluate(p1, sticky), C.evaluate(p1, sticky)], [null, null, null]);
  return t;
});

await browser.close();
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
