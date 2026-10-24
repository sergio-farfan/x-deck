// XDeckCore: pure helpers to read X's post markup and evaluate column filters.
// Shared by content/frame.js and tests/core.test.html. X's markup changes from
// time to time; the selectors in SEL are the place to update when it does.

(function () {
  'use strict';
  if (globalThis.XDeckCore) return;

  const SEL = {
    cell: '[data-testid="cellInnerDiv"]',
    article: 'article[data-testid="tweet"]',
    userName: '[data-testid="User-Name"]',
    text: '[data-testid="tweetText"]',
    social: '[data-testid="socialContext"]',
    actionBar: '[role="group"]',
    media: '[data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="card.layoutLarge.media"]',
    card: '[data-testid="card.wrapper"]',
    verified: '[data-testid="icon-verified"]',
    quote: 'div[role="link"]',
    userCell: '[data-testid="UserCell"]',
  };

  // Counter text to a number across X locales: "1.2K", "3,456", "1,2 mil",
  // "1.234", "12 Mio.", "1.5万".
  const SUFFIX = [
    [/^(k|mil|tsd\.?|k\.)$/i, 1e3],
    [/^(m|mio\.?|mill?\.?|millones|mi|mln)$/i, 1e6],
    [/^(b|bn|mrd\.?)$/i, 1e9],
    [/^万$/, 1e4],
    [/^億$/, 1e8],
  ];
  function num(s) {
    if (!s) return 0;
    const m = String(s).replace(/\u00a0/g, ' ').match(/(\d[\d.,\s]*\d|\d)\s*([A-Za-z\u4e00-\u9fff.]+)?/);
    if (!m) return 0;
    let digits = m[1].replace(/\s/g, '');
    const suffix = (m[2] || '').trim();
    const mult = (SUFFIX.find(([re]) => re.test(suffix)) || [null, 1])[1];
    const lastDot = digits.lastIndexOf('.');
    const lastComma = digits.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = lastDot > lastComma ? '.' : ',';
      digits = digits.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
    } else if (lastDot >= 0 || lastComma >= 0) {
      const sep = lastDot >= 0 ? '.' : ',';
      const parts = digits.split(sep);
      const thousands = mult === 1 && parts.length > 1 && parts.slice(1).every((p) => p.length === 3);
      digits = thousands ? parts.join('') : parts.join('.');
    }
    const n = parseFloat(digits);
    return Number.isFinite(n) ? Math.round(n * mult) : 0;
  }

  // Text including emoji, which X renders as <img alt="...">.
  function textWithAlt(el) {
    if (!el) return '';
    let out = '';
    const walk = (node) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) out += n.data;
        else if (n.nodeType === 1) {
          if (n.tagName === 'IMG') out += n.getAttribute('alt') || '';
          else if (n.tagName === 'BR') out += '\n';
          else walk(n);
        }
      }
    };
    walk(el);
    return out.trim();
  }

  // First match that is not inside a quoted post.
  function own(article, sel) {
    for (const el of article.querySelectorAll(sel)) {
      const q = el.closest(SEL.quote);
      if (!q || !article.contains(q)) return el;
    }
    return null;
  }

  function quoteOf(article) {
    const u = article.querySelector(`${SEL.quote} ${SEL.userName}`);
    return u ? u.closest(SEL.quote) : null;
  }

  function permalink(article) {
    const time = own(article, 'a[href*="/status/"] time');
    const a = time ? time.closest('a') : null;
    return a ? a.getAttribute('href') : null;
  }

  const AD_LABELS = new Set(['Ad', 'Promoted', 'Anuncio', 'Promocionado', 'Publicidad', 'Promovido', 'Sponsorisé',
    'Sponsorisée', 'Annonce', 'Anzeige', 'Gesponsert', 'Annuncio', 'Sponsorizzato', 'Advertentie', 'Gesponsord',
    'Reklama', 'Reklam', '広告', 'プロモーション', '광고', '推广', '廣告']);

  function hasAdLabel(article) {
    const spans = article.querySelectorAll('span');
    const limit = Math.min(spans.length, 60);
    for (let i = 0; i < limit; i++) {
      const s = spans[i];
      if (s.childElementCount) continue;
      if (AD_LABELS.has(s.textContent.trim()) && !s.closest(SEL.text) && !s.closest(SEL.userName)) return true;
    }
    return false;
  }

  // Needs a positive ad signal; a post that merely lacks a timestamp (for
  // example while X is still rendering it) is not treated as an ad.
  function isPromoted(article) {
    if (permalink(article)) return false;
    return !!article.querySelector('[data-testid="placementTracking"]') || hasAdLabel(article);
  }

  function metrics(article) {
    const out = { replies: 0, reposts: 0, likes: 0, bookmarks: 0, views: 0 };
    const group = own(article, `${SEL.actionBar}[aria-label]`);
    const label = group ? group.getAttribute('aria-label') : '';
    if (label) {
      const grab = (re) => { const m = label.match(re); return m ? num(m[1]) : 0; };
      out.replies = grab(/(\d[\d,.]*[KMB]?)\s+repl/i);
      out.reposts = grab(/(\d[\d,.]*[KMB]?)\s+(?:repost|retweet)/i);
      out.likes = grab(/(\d[\d,.]*[KMB]?)\s+like/i);
      out.bookmarks = grab(/(\d[\d,.]*[KMB]?)\s+bookmark/i);
      out.views = grab(/(\d[\d,.]*[KMB]?)\s+view/i);
    }
    const btn = (...ids) => { for (const id of ids) { const b = own(article, `[data-testid="${id}"]`); if (b) return b; } return null; };
    if (!out.replies) out.replies = num(btn('reply')?.textContent);
    if (!out.reposts) out.reposts = num(btn('retweet', 'unretweet')?.textContent);
    if (!out.likes) out.likes = num(btn('like', 'unlike')?.textContent);
    return out;
  }

  const REPLY_RE = /^(Replying to|En respuesta a|Em resposta a|En réponse à|Antwort an|In risposta a)\b/i;
  const REPOST_RE = /repost|retweet|reposte|retwe|republi/i;

  function parseArticle(article) {
    const href = permalink(article);
    const m = href && href.match(/^\/([^/]+)\/status\/(\d+)/);
    if (!m) return null;
    const userName = own(article, SEL.userName);
    let name = '';
    let handle = m[1];
    if (userName) {
      const spans = [...userName.querySelectorAll('span')].map((s) => textWithAlt(s)).filter(Boolean);
      name = spans[0] || '';
      const at = spans.find((s) => /^@\w{1,15}$/.test(s));
      if (at) handle = at.slice(1);
    }
    const textEl = own(article, SEL.text);
    const social = article.querySelector(SEL.social);
    const socialText = social ? social.textContent.trim() : '';
    const socialLink = social ? social.closest('a') || social.querySelector('a') : null;
    const quote = quoteOf(article);
    const quoteText = quote ? textWithAlt(quote.querySelector(SEL.text)) : '';
    let isReply = false;
    for (const d of article.querySelectorAll('div')) {
      if (d.childElementCount > 3) continue;
      if ((textEl && (textEl.contains(d) || d.contains(textEl))) || (quote && quote.contains(d))) continue;
      const t = d.textContent;
      if (t.length > 160) continue;
      if (REPLY_RE.test(t.trim())) { isReply = true; break; }
    }
    const time = own(article, 'time');
    const tcoLinks = textEl ? [...textEl.querySelectorAll('a[href^="https://t.co/"]')].map((a) => a.getAttribute('href')) : [];
    return {
      id: m[2],
      url: `https://x.com/${handle}/status/${m[2]}`,
      handle,
      name,
      text: textWithAlt(textEl),
      quoteText,
      lang: textEl ? textEl.getAttribute('lang') || '' : '',
      time: time ? time.getAttribute('datetime') : '',
      isRepost: !!social && REPOST_RE.test(socialText),
      reposter: socialLink && socialLink.getAttribute('href') ? socialLink.getAttribute('href').replace(/^\//, '').split('/')[0] : '',
      socialText,
      isReply,
      isQuote: !!quote,
      hasMedia: !!own(article, SEL.media),
      hasLinks: !!own(article, SEL.card) || tcoLinks.length > 0,
      links: tcoLinks,
      verified: !!(userName && userName.querySelector(SEL.verified)),
      metrics: metrics(article),
    };
  }

  // ---------- filters ----------

  // Comma/newline separated terms; a /regex/flags term is kept whole even if it
  // contains commas, e.g. /a{1,3}/.
  function splitTerms(s) {
    const str = String(s || '');
    const out = [];
    let i = 0;
    while (i < str.length) {
      while (i < str.length && /[\s,]/.test(str[i])) i++;
      if (i >= str.length) break;
      if (str[i] === '/') {
        const m = str.slice(i).match(/^\/((?:\\.|[^\\/\n])+)\/([a-z]*)(?=\s*(?:[,\n]|$))/);
        if (m) { out.push(m[0]); i += m[0].length; continue; }
      }
      let j = i;
      while (j < str.length && str[j] !== ',' && str[j] !== '\n') j++;
      const term = str.slice(i, j).trim();
      if (term) out.push(term);
      i = j + 1;
    }
    return out;
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Scripts written without spaces between words: match these terms anywhere.
  const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

  // ---------- regex safety ----------
  // A user /regex/ term runs on the page's main thread for every post, and
  // JavaScript regexes can backtrack exponentially. This is a conservative
  // static check (not a proof): it refuses patterns that are long, use
  // backreferences, repeat a group that holds a repeat or an alternation
  // ((a+)+, (\w+\s?)*, (a|aa)+), or stack more than two unbounded repeats
  // (.*.*.*x). The text matched is also capped (MAX_HAY). src/terms.js holds an
  // identical copy for the editor; tests/core.test.mjs keeps the two in step.
  const MAX_REGEX = 200;
  const MAX_HAY = 1500;
  const REGEX_FLAGS = /^[dgimsuvy]*$/;

  function regexProblem(src) {
    if (src.length > MAX_REGEX) return `longer than ${MAX_REGEX} characters`;
    if (/\\[1-9]|\\k</.test(src)) return 'backreferences are not allowed';
    const plain = src.replace(/\\./g, '_').replace(/\[(?:[^\]\\]|\\.)*\]/g, '_');
    const repeat = /[*+]|\{\d+,\}/g;
    if ((plain.match(repeat) || []).length > 2) return 'more than two unbounded repeats (* + {n,})';
    const stack = [];
    for (let i = 0; i < plain.length; i++) {
      const c = plain[i];
      if (c === '(') stack.push(i);
      else if (c === ')') {
        const start = stack.pop();
        if (start === undefined) continue;
        if (/^(?:[*+]|\{\d+,\})/.test(plain.slice(i + 1)) && /[*+|]|\{\d+,\}/.test(plain.slice(start + 1, i))) {
          return 'a repeated group may not contain | or another repeat';
        }
      }
    }
    return '';
  }

  // '' when the term is fine, otherwise the reason it is not usable as a /regex/.
  function regexTermProblem(term) {
    const rm = term.match(/^\/(.+)\/([a-z]*)$/);
    if (!rm || !REGEX_FLAGS.test(rm[2])) return '';
    const bad = regexProblem(rm[1]);
    if (bad) return bad;
    try { new RegExp(rm[1], rm[2].replace(/[gy]/g, '')); } catch (e) { return `invalid pattern (${String(e.message).replace(/^Invalid regular expression: /, '')})`; }
    return '';
  }

  // A term is a regex only when it looks like /pattern/flags with valid flags;
  // anything else (for example "/r/politics") is a plain word. An unsafe or
  // uncompilable regex is skipped rather than run.
  function termToRegex(term) {
    const rm = term.match(/^\/(.+)\/([a-z]*)$/);
    if (rm && REGEX_FLAGS.test(rm[2])) {
      if (regexTermProblem(term)) return null;
      const flags = [...new Set(rm[2].replace(/[gy]/g, '').split(''))].join('');
      try { return new RegExp(rm[1], flags.includes('i') ? flags : `${flags}i`); } catch { return null; }
    }
    if (NO_SPACE_SCRIPT.test(term)) return new RegExp(escapeRe(term), 'iu');
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRe(term)}($|[^\\p{L}\\p{N}_])`, 'iu');
  }

  function compileList(s) {
    return splitTerms(s).map(termToRegex).filter(Boolean);
  }

  const cache = new Map();

  function compileFilters(filters, globalMute) {
    const key = JSON.stringify([filters || {}, globalMute || '']);
    if (cache.has(key)) return cache.get(key);
    const f = filters || {};
    const cf = {
      f,
      mute: compileList(globalMute),
      exclude: compileList(f.exclude),
      include: compileList(f.include),
      users: new Set(splitTerms(f.excludeUsers).map((u) => u.replace(/^@/, '').toLowerCase())),
      langs: new Set(splitTerms(String(f.lang || '').replace(/\s+/g, ',')).map((l) => l.toLowerCase())),
    };
    if (cache.size > 50) cache.clear();
    cache.set(key, cf);
    return cf;
  }

  const anyMatch = (list, hay) => list.some((re) => re.test(hay));

  // Returns null to keep the post, or a short reason string to hide it.
  function evaluate(post, cf) {
    if (!post) return null;
    const f = cf.f;
    const hay = `${post.text.slice(0, MAX_HAY)}\n${String(post.quoteText || '').slice(0, 500)}\n${post.name}\n@${post.handle}`;
    if (cf.mute.length && anyMatch(cf.mute, hay)) return 'muted';
    if (cf.exclude.length && anyMatch(cf.exclude, hay)) return 'excluded word';
    if (cf.users.size && (cf.users.has(post.handle.toLowerCase()) || (post.reposter && cf.users.has(post.reposter.toLowerCase())))) return 'excluded user';
    if (cf.include.length && !anyMatch(cf.include, hay)) return 'missing keyword';
    if (f.onlyMedia && !post.hasMedia) return 'no media';
    if (f.onlyLinks && !post.hasLinks) return 'no link';
    if (f.hideReplies && post.isReply) return 'reply';
    if (f.hideReposts && post.isRepost) return 'repost';
    if (f.hideQuotes && post.isQuote) return 'quote';
    if (f.onlyVerified && !post.verified) return 'not verified';
    if (f.hideVerified && post.verified) return 'verified';
    if (+f.minLikes > 0 && post.metrics.likes < +f.minLikes) return 'few likes';
    if (+f.minReposts > 0 && post.metrics.reposts < +f.minReposts) return 'few reposts';
    if (+f.minReplies > 0 && post.metrics.replies < +f.minReplies) return 'few replies';
    if (cf.langs.size && post.lang && !cf.langs.has(post.lang.toLowerCase())) return 'language';
    return null;
  }

  globalThis.XDeckCore = { regexProblem, regexTermProblem, SEL, num, textWithAlt, own, permalink, isPromoted, parseArticle, compileFilters, evaluate, splitTerms };
})();
