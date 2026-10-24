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
  // ---- regex safety ----
  const timed = (fn) => { const t0 = performance.now(); const r = fn(); return [r, performance.now() - t0]; };
  const evil = ['/(a+)+$/', '/^(\\w+\\s?)+$/', '/(.*)*x/', '/.*.*.*.*x/', '/(a|aa)+$/', '/(a*)\\1/'];
  const victim = { text: 'a'.repeat(40) + '!', quoteText: '', name: '', handle: 'h', metrics: {} };
  for (const term of evil) {
    const [r, ms] = timed(() => C.evaluate(victim, C.compileFilters({ exclude: term }, '')));
    eq(`unsafe regex ${term} is skipped and returns fast`, [r, ms < 200], [null, true]);
  }
  const [rLong, msLong] = timed(() => C.evaluate({ ...victim, text: 'a'.repeat(100000) }, C.compileFilters({ exclude: '/a+b/' }, '')));
  eq('huge post text is capped before matching', msLong < 200, true);
  eq('normal regexes still work', [
    C.evaluate({ ...victim, text: 'Breaking: big news' }, C.compileFilters({ include: '/break(ing)?\\b/' }, '')),
    C.evaluate({ ...victim, text: 'free 100x giveaway' }, C.compileFilters({ exclude: '/\\d+x\\s+giveaway/' }, '')),
    C.evaluate({ ...victim, text: 'sale at 50% off' }, C.compileFilters({ exclude: '/(sale|discount)/' }, '')),
  ], [null, 'excluded word', 'excluded word']);
  eq('a /path/-looking term is a plain word, not a dropped regex', C.evaluate({ ...victim, text: 'see /r/politics today' }, C.compileFilters({ exclude: '/r/politics' }, '')), 'excluded word');
  eq('an uncompilable regex is skipped, not run', C.evaluate({ ...victim, text: 'x ( y' }, C.compileFilters({ exclude: '/(unclosed/' }, '')), null);
  // ---- non-English counts, replies, reposts, ads ----
  eq('num: Cyrillic, Hangul, Polish, Czech and Turkish suffixes', [
    C.num('12 \u0442\u044b\u0441.', 'ru'), C.num('1,2 \u0442\u044b\u0441.', 'ru'), C.num('3,4 \u043c\u043b\u043d', 'ru'), C.num('1.2\uc2dc'.replace('\uc2dc', '\ucc9c'), 'ko'), C.num('1.2\ub9cc', 'ko'),
    C.num('3\uc5b5', 'ko'), C.num('1,2 tys.', 'pl'), C.num('1,2 tis.', 'cs'), C.num('1,2 Mn', 'tr'), C.num('12 B', 'tr'), C.num('12 B', 'en'),
  ], [12000, 1200, 3400000, 1200, 12000, 300000000, 1200, 1200, 1200000, 12000, 12000000000]);
  eq('num: an unknown suffix is NaN, never a wrong number', Number.isNaN(C.num('12 zzz', 'en')), true);
  eq('filters: a count that could not be read never hides a post', ev({ ...p4, metrics: { likes: NaN, reposts: 0, replies: 0 } }, { minLikes: 100 }), null);
  const withReplyRow = (phrase) => {
    const a = a1.cloneNode(true);
    const row = [...a.querySelectorAll('div')].find((d) => d.firstChild && d.firstChild.nodeType === 3 && /^Replying to/.test(d.firstChild.textContent.trim()));
    row.firstChild.textContent = phrase;
    return a;
  };
  eq('reply: French "En r\u00e9ponse \u00e0" (the old \\b never matched)', C.parseArticle(withReplyRow('En r\u00e9ponse \u00e0 ')).isReply, true);
  eq('reply: Japanese, Arabic and Hindi are recognised structurally', ['\u8fd4\u4fe1\u5148: ', '\u0631\u062f\u0627 \u0639\u0644\u0649 ', '\u091c\u0935\u093e\u092c '].map((ph) => C.parseArticle(withReplyRow(ph)).isReply), [true, true, true]);
  eq('reply: an ordinary post is not a reply', [C.parseArticle(a4).isReply, C.parseArticle(a2).isReply], [false, false]);
  const asMentionPost = a4.cloneNode(true);
  asMentionPost.querySelector('[data-testid="tweetText"]').innerHTML = '<a href="/carol">@carol</a> look at this';
  eq('reply: a post that starts with a mention is not a reply', C.parseArticle(asMentionPost).isReply, false);
  const repostOf = (word) => { const a = a2.cloneNode(true); a.querySelector('[data-testid="socialContext"]').textContent = word; return C.parseArticle(a).isRepost; };
  eq('repost: Japanese, Korean and Russian words, and any language through the profile link', [repostOf('\u30ea\u30dd\u30b9\u30c8\u3057\u307e\u3057\u305f'), repostOf('\uc7ac\uac8c\uc2dc\ud588\uc2b5\ub2c8\ub2e4'), repostOf('\u0420\u0435\u043f\u043e\u0441\u0442'), repostOf('zzz')], [true, true, true, true]);
  const adWith = (label) => { const a = a3.cloneNode(true); [...a.querySelectorAll('span')].find((x) => x.textContent.trim() === 'Ad').textContent = label; return C.isPromoted(a); };
  eq('ads: labels in more languages; ordinary words are not ads', [adWith('\u0420\u0435\u043a\u043b\u0430\u043c\u0430'), adWith('\u0625\u0639\u0644\u0627\u0646'), adWith('\u0e42\u0e06\u0e29\u0e13\u0e32'), adWith('Hello')], [true, true, true, false]);
  eq('filters: a Korean mute word matches with attached particles', ev({ ...p4, text: '\uc0bc\uc131\uc774 \ubc1c\ud45c\ud588\ub2e4' }, { exclude: '\uc0bc\uc131' }), 'excluded word');
  eq('filters: posts tagged und/zxx are not "another language"', ['und', 'zxx', 'qme', 'es'].map((l) => ev({ ...p4, lang: l }, { lang: 'en' })), [null, null, null, 'language']);
  window.__guardTable = ['/(a+)+$/', '/a{1,3}/', '/(foo|bar)+/', '/(foo|bar)?/', '/\\bword\\b/', '/.*.*x/', '/.*.*.*x/', '/[a+]+[b*]+/', '/(?=.*a)(?=.*b)/', '/(ab)\\1/', '/x'.padEnd(220, 'x') + '/', '/r/politics', '/(unclosed/', 'plain', '/a/gi', '/a/zz']
    .map((term) => [term, C.regexTermProblem(term)]);
  return t;
});

const { regexTermProblem, splitTerms: splitTermsEditor } = await import('../src/terms.js');
const table = await page.evaluate(() => window.__guardTable);
for (const [term, pageResult] of table) {
  results.push({ name: `editor and page guards agree on ${term.slice(0, 30)}`, ok: !!regexTermProblem(term) === !!pageResult, got: regexTermProblem(term), want: pageResult });
}
const splitCases = ['a, b', '/a{1,3}/, c', 'x,\n/y,z/i', '', '  ,  ', '/r/politics, spoiler'];
const pageSplit = await page.evaluate((cases) => cases.map((c) => globalThis.XDeckCore.splitTerms(c)), splitCases);
splitCases.forEach((c, i) => results.push({ name: `editor and page splitTerms agree on ${JSON.stringify(c)}`, ok: JSON.stringify(splitTermsEditor(c)) === JSON.stringify(pageSplit[i]), got: splitTermsEditor(c), want: pageSplit[i] }));
const expectBlocked = ['/(a+)+$/', '/.*.*.*x/', '/(foo|bar)+/', '/(ab)\\1/'];
const expectFine = ['/a{1,3}/', '/(foo|bar)?/', '/.*.*x/', '/\\bword\\b/', '/r/politics', 'plain'];
for (const t of expectBlocked) results.push({ name: `guard blocks ${t}`, ok: !!regexTermProblem(t), got: regexTermProblem(t), want: 'a reason' });
for (const t of expectFine) results.push({ name: `guard allows ${t}`, ok: regexTermProblem(t) === '', got: regexTermProblem(t), want: '' });

await browser.close();
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `  got=${JSON.stringify(r.got)} want=${JSON.stringify(r.want)}`}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
