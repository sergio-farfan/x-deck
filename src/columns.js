// Column catalog: types, URL builders, search-query builder and URL parsing.
// Search operators follow the community reference at
// github.com/igorbrigadir/twitter-advanced-search (X publishes no full list).

export const WIDTHS = { narrow: 310, medium: 370, wide: 470, xwide: 600 };

export const DEFAULT_FILTERS = {
  include: '',        // any of these words/phrases must appear (comma or newline separated, /regex/ allowed)
  exclude: '',        // hide posts containing any of these
  excludeUsers: '',   // hide posts from these handles
  lang: '',           // keep only these language codes, e.g. "en, es"
  onlyMedia: false,
  onlyLinks: false,
  hideReplies: false,
  hideReposts: false,
  hideQuotes: false,
  onlyVerified: false,
  hideVerified: false,
  minLikes: 0,
  minReposts: 0,
  minReplies: 0,
  dedupe: false,      // hide posts already shown in another column of this workspace
};

export const COLUMN_TYPES = [
  { type: 'home', label: 'Home', icon: 'home', desc: 'Following (chronological) or For you.' },
  { type: 'notifications', label: 'Notifications', icon: 'bell', desc: 'All, verified or mentions only.' },
  { type: 'search', label: 'Search', icon: 'search', desc: 'Keywords, operators and news monitoring.' },
  { type: 'list', label: 'List', icon: 'list', desc: 'Any X list by URL or ID.' },
  { type: 'user', label: 'Profile', icon: 'user', desc: 'Posts, replies or media from an account.' },
  { type: 'bookmarks', label: 'Bookmarks', icon: 'bookmark', desc: 'Posts you bookmarked on X.' },
  { type: 'explore', label: 'Explore', icon: 'trending', desc: 'Trending, news, sports, entertainment.' },
  { type: 'messages', label: 'Messages', icon: 'mail', desc: 'Direct messages.' },
  { type: 'community', label: 'Community', icon: 'users', desc: 'A community by URL or ID.' },
  { type: 'likes', label: 'Likes', icon: 'heart', desc: 'Posts liked by your account.' },
  { type: 'grok', label: 'Grok', icon: 'sparkle', desc: 'The Grok assistant.' },
  { type: 'custom', label: 'Custom URL', icon: 'link', desc: 'Any x.com page.' },
];

export const TYPE_BY_ID = Object.fromEntries(COLUMN_TYPES.map((t) => [t.type, t]));

export const SEARCH_MODES = [
  ['live', 'Latest'],
  ['top', 'Top'],
  ['media', 'Media'],
  ['user', 'People'],
];

export const EXPLORE_TABS = [
  ['trending', 'Trending'],
  ['news', 'News'],
  ['sports', 'Sports'],
  ['entertainment', 'Entertainment'],
];

// Major news outlets for the "news sites" searches. X's own filter:news matches
// a hidden domain list that returned nothing in a live test, so news searches
// match links by domain with url:, which works well for domains (see
// github.com/igorbrigadir/twitter-advanced-search). X stops honoring a query at
// roughly 22 operators (every url: and OR counts), so keep this list at 8 or
// fewer: the longest preset then uses 20.
export const NEWS_DOMAINS = [
  'reuters.com', 'apnews.com', 'bbc.com', 'cnn.com', 'nytimes.com', 'theguardian.com', 'bloomberg.com', 'wsj.com',
];

export const NEWS_SITES = `(${NEWS_DOMAINS.map((d) => `url:${d}`).join(' OR ')})`;

export const SEARCH_PRESETS = [
  { label: 'Breaking news', query: `(breaking OR "just in" OR developing OR urgent) ${NEWS_SITES} -filter:replies` },
  { label: 'News links', query: `${NEWS_SITES} -filter:replies min_faves:10` },
  { label: 'Viral now', query: 'min_faves:2000 -filter:replies' },
  { label: 'AI news', query: `(AI OR LLM OR OpenAI OR Anthropic OR Gemini) ${NEWS_SITES} -filter:replies` },
  { label: 'Media only', query: 'filter:media -filter:replies min_faves:50' },
  { label: 'Questions to me', query: 'to:YOUR_HANDLE ?' },
];

// Default News-workspace queries shipped in v0.1.0 that depended on filter:news.
export const RETIRED_DEFAULT_QUERIES = new Map([
  ['(breaking OR "just in" OR developing) filter:news -filter:replies', SEARCH_PRESETS[0].query],
  ['filter:news -filter:replies min_faves:10', SEARCH_PRESETS[1].query],
]);

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
const RESERVED_PATHS = new Set([
  'home', 'explore', 'notifications', 'messages', 'settings', 'i', 'search', 'compose',
  'login', 'logout', 'signup', 'tos', 'privacy', 'jobs', 'hashtag', 'intent', 'share',
]);

export function uid(prefix = 'c') {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function cleanHandle(s) {
  return String(s || '').trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
}

function idFrom(s, kind) {
  const str = String(s || '').trim();
  const m = str.match(new RegExp(`/${kind}/(\\d+)`)) || str.match(/^(\d+)$/);
  return m ? m[1] : '';
}

export function makeColumn(type, params = {}, extra = {}) {
  return normalizeColumn({ id: uid(), type, params, ...extra });
}

export function normalizeColumn(c) {
  const col = {
    id: c.id || uid(),
    type: TYPE_BY_ID[c.type] ? c.type : 'custom',
    title: c.title || '',
    width: WIDTHS[c.width] ? c.width : 'medium',
    refreshSec: Number.isFinite(+c.refreshSec) ? +c.refreshSec : 60,
    refreshMode: c.refreshMode === 'reload' ? 'reload' : 'soft',
    notify: !!c.notify,
    params: { ...(c.params || {}) },
    filters: { ...DEFAULT_FILTERS, ...(c.filters || {}) },
  };
  return col;
}

export function safeXUrl(url) {
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^(www|mobile)\./, '');
    if (host !== 'x.com' && host !== 'twitter.com') return null;
    if (/^\/i\/xdeck/i.test(u.pathname)) return null; // never load the deck inside itself
    u.hostname = 'x.com';
    return u.toString();
  } catch {
    return null;
  }
}

export function buildUrl(col) {
  const p = col.params || {};
  const base = 'https://x.com';
  switch (col.type) {
    case 'home':
      return `${base}/home`;
    case 'notifications':
      if (p.scope === 'mentions') return `${base}/notifications/mentions`;
      if (p.scope === 'verified') return `${base}/notifications/verified`;
      return `${base}/notifications`;
    case 'search': {
      const q = String(p.query || '').trim() || 'min_faves:1000 -filter:replies';
      const mode = SEARCH_MODES.some(([m]) => m === p.mode) ? p.mode : 'live';
      return `${base}/search?q=${encodeURIComponent(q)}&src=typed_query${mode === 'top' ? '' : `&f=${mode}`}`;
    }
    case 'list':
      return `${base}/i/lists/${idFrom(p.list, 'lists') || '0'}`;
    case 'community':
      return `${base}/i/communities/${idFrom(p.community, 'communities') || '0'}`;
    case 'user': {
      const h = cleanHandle(p.handle) || 'X';
      if (p.tab === 'replies') return `${base}/${h}/with_replies`;
      if (p.tab === 'media') return `${base}/${h}/media`;
      return `${base}/${h}`;
    }
    case 'likes':
      return `${base}/${cleanHandle(p.handle) || 'X'}/likes`;
    case 'bookmarks':
      return `${base}/i/bookmarks`;
    case 'explore':
      return `${base}/explore/tabs/${EXPLORE_TABS.some(([t]) => t === p.exploreTab) ? p.exploreTab : 'trending'}`;
    case 'messages':
      return `${base}/messages`;
    case 'grok':
      return `${base}/i/grok`;
    case 'custom':
    default:
      return safeXUrl(p.url) || `${base}/home`;
  }
}

export function describe(col) {
  const p = col.params || {};
  const t = TYPE_BY_ID[col.type] || TYPE_BY_ID.custom;
  let title = t.label;
  let sub = '';
  switch (col.type) {
    case 'home': sub = p.homeTab === 'foryou' ? 'For you' : 'Following'; break;
    case 'notifications': sub = p.scope === 'mentions' ? 'Mentions' : p.scope === 'verified' ? 'Verified' : 'All'; break;
    case 'search':
      title = String(p.query || '').trim() || 'Search';
      sub = `Search · ${(SEARCH_MODES.find(([m]) => m === p.mode) || SEARCH_MODES[0])[1]}`;
      break;
    case 'list': sub = `List ${idFrom(p.list, 'lists')}`; break;
    case 'community': sub = `Community ${idFrom(p.community, 'communities')}`; break;
    case 'user': title = `@${cleanHandle(p.handle)}`; sub = p.tab === 'replies' ? 'Posts & replies' : p.tab === 'media' ? 'Media' : 'Posts'; break;
    case 'likes': sub = `@${cleanHandle(p.handle)}`; break;
    case 'explore': sub = (EXPLORE_TABS.find(([e]) => e === p.exploreTab) || EXPLORE_TABS[0])[1]; break;
    case 'custom': {
      const u = safeXUrl(p.url);
      sub = u ? new URL(u).pathname : 'x.com';
      break;
    }
    default: break;
  }
  if (col.title) { sub = sub || t.label; title = col.title; }
  return { title, sub, icon: t.icon };
}

// Map an x.com URL onto the closest column type.
export function columnFromUrl(url) {
  const safe = safeXUrl(url);
  if (!safe) return null;
  const u = new URL(safe);
  const path = u.pathname.replace(/\/+$/, '') || '/';
  let m;
  if (path === '/home') return makeColumn('home', { homeTab: 'following' });
  if (path.startsWith('/notifications')) {
    return makeColumn('notifications', { scope: path.endsWith('/mentions') ? 'mentions' : path.endsWith('/verified') ? 'verified' : 'all' });
  }
  if (path === '/search') {
    const f = u.searchParams.get('f');
    return makeColumn('search', { query: u.searchParams.get('q') || '', mode: SEARCH_MODES.some(([x]) => x === f) ? f : 'top' });
  }
  if ((m = path.match(/^\/i\/lists\/(\d+)/))) return makeColumn('list', { list: m[1] });
  if ((m = path.match(/^\/i\/communities\/(\d+)/))) return makeColumn('community', { community: m[1] });
  if (path === '/i/bookmarks') return makeColumn('bookmarks');
  if (path === '/i/grok') return makeColumn('grok');
  if (path.startsWith('/messages')) return makeColumn('messages');
  if ((m = path.match(/^\/explore\/tabs\/([\w-]+)/))) return makeColumn('explore', { exploreTab: m[1] });
  if ((m = path.match(/^\/([A-Za-z0-9_]{1,15})(?:\/(with_replies|media|likes))?$/)) && !RESERVED_PATHS.has(m[1].toLowerCase())) {
    if (m[2] === 'likes') return makeColumn('likes', { handle: m[1] });
    return makeColumn('user', { handle: m[1], tab: m[2] === 'with_replies' ? 'replies' : m[2] === 'media' ? 'media' : 'posts' });
  }
  return makeColumn('custom', { url: safe });
}

function splitWords(s) {
  return String(s || '').split(/[\s,]+/).map((w) => w.trim()).filter(Boolean);
}

function orGroup(items) {
  if (!items.length) return '';
  return items.length > 1 ? `(${items.join(' OR ')})` : items[0];
}

// Build an X search query from the advanced-search form.
export function buildSearchQuery(b) {
  const parts = [];
  if (b.all && b.all.trim()) parts.push(b.all.trim());
  if (b.exact && b.exact.trim()) parts.push(`"${b.exact.trim().replace(/"/g, '')}"`);
  const any = orGroup(splitWords(b.any));
  if (any) parts.push(any);
  splitWords(b.none).forEach((w) => parts.push(`-${w.replace(/^-/, '')}`));
  const tags = orGroup(splitWords(b.hashtags).map((t) => (t.startsWith('#') ? t : `#${t}`)));
  if (tags) parts.push(tags);
  const from = orGroup(splitWords(b.from).map((h) => `from:${cleanHandle(h)}`));
  if (from) parts.push(from);
  const to = orGroup(splitWords(b.to).map((h) => `to:${cleanHandle(h)}`));
  if (to) parts.push(to);
  const ment = orGroup(splitWords(b.mentions).map((h) => `@${cleanHandle(h)}`));
  if (ment) parts.push(ment);
  if (b.list && idFrom(b.list, 'lists')) parts.push(`list:${idFrom(b.list, 'lists')}`);
  if (b.lang) parts.push(`lang:${b.lang}`);
  if (+b.minFaves > 0) parts.push(`min_faves:${+b.minFaves}`);
  if (+b.minRetweets > 0) parts.push(`min_retweets:${+b.minRetweets}`);
  if (+b.minReplies > 0) parts.push(`min_replies:${+b.minReplies}`);
  if (b.newsSites) parts.push(NEWS_SITES);
  if (b.news) parts.push('filter:news');
  if (b.links) parts.push('filter:links');
  if (b.media) parts.push('filter:media');
  if (b.verified) parts.push('filter:blue_verified');
  if (b.replies === 'exclude') parts.push('-filter:replies');
  if (b.replies === 'only') parts.push('filter:replies');
  if (b.reposts) parts.push('include:nativeretweets');
  if (b.since) parts.push(`since:${b.since}`);
  if (b.until) parts.push(`until:${b.until}`);
  return parts.join(' ');
}

export function isValidHandle(h) {
  return HANDLE_RE.test(cleanHandle(h));
}
