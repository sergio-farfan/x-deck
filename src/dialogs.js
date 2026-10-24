// Dialogs: add/edit column (source, display, filters), settings, help.

import { h, icon, openDialog, clear, toast } from './dom.js';
import { termsError } from './terms.js';
import { IMPORT_LIMITS } from './store.js';
import {
  COLUMN_TYPES, TYPE_BY_ID, SEARCH_MODES, EXPLORE_TABS, SEARCH_PRESETS, DEFAULT_FILTERS,
  makeColumn, normalizeColumn, buildSearchQuery, cleanHandle, isValidHandle, safeXUrl,
} from './columns.js';

export const REFRESH_CHOICES = [
  [0, 'Off'], [15, 'Every 15 s'], [30, 'Every 30 s'], [60, 'Every minute'], [120, 'Every 2 min'],
  [300, 'Every 5 min'], [600, 'Every 10 min'], [900, 'Every 15 min'], [1800, 'Every 30 min'], [3600, 'Every hour'],
];

export const REFRESH_METHODS = [
  ['soft', 'Load new posts (light)'],
  ['reload', 'Reload the page (heavier)'],
];

const WIDTH_CHOICES = [['narrow', 'Narrow'], ['medium', 'Medium'], ['wide', 'Wide'], ['xwide', 'Extra wide']];

const LANGS = [
  ['', 'Any language'], ['en', 'English'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['fr', 'French'],
  ['de', 'German'], ['it', 'Italian'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['zh', 'Chinese'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['ru', 'Russian'], ['tr', 'Turkish'],
];

const ACCENTS = [
  ['#1d9bf0', 'Blue'], ['#7856ff', 'Violet'], ['#a100ff', 'Purple'], ['#f91880', 'Pink'],
  ['#ff7a00', 'Orange'], ['#00ba7c', 'Green'], ['#ffd400', 'Yellow'],
];

// ---------- small form helpers ----------

function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', null, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
}

function select(options, value, attrs = {}) {
  return h('select', { class: 'input', ...attrs },
    options.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(value) }, l)));
}

function check(label, checked, attrs = {}) {
  const input = h('input', { type: 'checkbox', checked: !!checked, ...attrs });
  return { el: h('label', { class: 'check' }, input, h('span', null, label)), input };
}

function text(value, attrs = {}) {
  return h('input', { class: 'input', type: 'text', value: value || '', spellcheck: 'false', ...attrs });
}

function area(value, attrs = {}) {
  const t = h('textarea', { class: 'input', rows: 2, spellcheck: 'false', ...attrs });
  t.value = value || '';
  return t;
}

function number(value, attrs = {}) {
  return h('input', { class: 'input', type: 'number', min: '0', step: '1', value: String(+value || 0), ...attrs });
}

function section(title, ...children) {
  return h('section', { class: 'form-section' }, h('h3', null, title), ...children);
}

// ---------- advanced search builder ----------

function searchBuilder(onApply) {
  const all = text('', { placeholder: 'climate summit' });
  const exact = text('', { placeholder: 'press conference' });
  const any = text('', { placeholder: 'cats dogs' });
  const none = text('', { placeholder: 'spoilers giveaway' });
  const hashtags = text('', { placeholder: '#AI #news' });
  const from = text('', { placeholder: '@reuters @AP' });
  const to = text('', { placeholder: '@handle' });
  const mentions = text('', { placeholder: '@handle' });
  const list = text('', { placeholder: 'List URL or ID (members of)' });
  const lang = select(LANGS, '');
  const minFaves = number(0);
  const minRetweets = number(0);
  const minReplies = number(0);
  const since = h('input', { class: 'input', type: 'date' });
  const until = h('input', { class: 'input', type: 'date' });
  const replies = select([['', 'Replies: include'], ['exclude', 'Replies: exclude'], ['only', 'Replies: only']], 'exclude');
  const newsSites = check('Links to major news sites (domain list)', false);
  const news = check("X's own news filter (filter:news, may return nothing)", false);
  const links = check('Has links', false);
  const media = check('Has media', false);
  const verified = check('From verified accounts', false);
  const reposts = check('Include reposts', false);
  const preview = h('code', { class: 'builder-preview' });
  const values = () => ({
    all: all.value, exact: exact.value, any: any.value, none: none.value, hashtags: hashtags.value,
    from: from.value, to: to.value, mentions: mentions.value, list: list.value, lang: lang.value,
    minFaves: minFaves.value, minRetweets: minRetweets.value, minReplies: minReplies.value,
    since: since.value, until: until.value, replies: replies.value,
    newsSites: newsSites.input.checked, news: news.input.checked, links: links.input.checked, media: media.input.checked,
    verified: verified.input.checked, reposts: reposts.input.checked,
  });
  const box = h('div', { class: 'builder-grid' },
    field('All of these words', all), field('This exact phrase', exact),
    field('Any of these words', any), field('None of these words', none),
    field('Hashtags', hashtags), field('Language', lang),
    field('From accounts', from), field('To accounts', to),
    field('Mentioning', mentions), field('From list members', list),
    field('Min likes', minFaves), field('Min reposts', minRetweets),
    field('Min replies', minReplies), field('Replies', replies),
    field('Since', since), field('Until', until),
    h('div', { class: 'builder-checks' }, newsSites.el, news.el, links.el, media.el, verified.el, reposts.el));
  const update = () => { preview.textContent = buildSearchQuery(values()) || '(empty)'; };
  box.addEventListener('input', update);
  box.addEventListener('change', update);
  update();
  return h('details', { class: 'builder' },
    h('summary', null, 'Advanced search builder'),
    box,
    h('div', { class: 'builder-foot' }, preview,
      h('button', { type: 'button', class: 'btn', onclick: () => { const q = buildSearchQuery(values()); if (q) onApply(q); } }, 'Use this query')));
}

// ---------- column editor ----------

export function openColumnEditor({ column, isNew, settings, onSave, onDelete }) {
  const draft = column
    ? normalizeColumn(structuredClone(column))
    : makeColumn('home', { homeTab: 'following' }, { width: settings.columnWidth, refreshSec: settings.autoRefreshSec });
  let typeSel = draft.type;
  let readSource = () => ({});
  const sourceBox = h('div', { class: 'source' });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });

  function renderSource() {
    clear(sourceBox);
    const p = typeSel === draft.type ? draft.params : {};
    const t = TYPE_BY_ID[typeSel];
    sourceBox.append(h('div', { class: 'source-head' }, icon(t.icon, 20), h('div', null, h('strong', null, t.label), h('div', { class: 'muted' }, t.desc))));
    const add = (...els) => sourceBox.append(...els);
    switch (typeSel) {
      case 'home': {
        const s = select([['following', 'Following (chronological)'], ['foryou', 'For you (algorithmic)']], p.homeTab || 'following');
        add(field('Timeline', s, 'XDeck switches the column to this tab when it loads.'));
        readSource = () => ({ homeTab: s.value });
        break;
      }
      case 'notifications': {
        const s = select([['all', 'All'], ['verified', 'Verified'], ['mentions', 'Mentions']], p.scope || 'all');
        add(field('Show', s));
        readSource = () => ({ scope: s.value });
        break;
      }
      case 'search': {
        const q = area(p.query, { rows: 3, class: 'input mono', placeholder: '(AI OR LLM) -filter:replies lang:en min_faves:20' });
        const mode = select(SEARCH_MODES, p.mode || 'live');
        const presets = h('div', { class: 'chips' }, SEARCH_PRESETS.map((pr) => h('button', {
          type: 'button', class: 'chip', title: pr.query, onclick: () => { q.value = pr.query; q.focus(); },
        }, pr.label)));
        add(
          field('Query', q, 'X search operators work here: from:, to:, @, lang:, min_faves:, min_retweets:, url:domain.com, filter:media, -filter:replies, since:, until:, list:'),
          field('Results', mode),
          h('div', { class: 'field' }, h('span', null, 'Presets'), presets),
          searchBuilder((query) => { q.value = query; }));
        readSource = () => {
          const v = q.value.trim();
          if (!v) throw new Error('Enter a search query.');
          return { query: v, mode: mode.value };
        };
        break;
      }
      case 'list': {
        const i = text(p.list, { placeholder: 'https://x.com/i/lists/1234567890' });
        add(field('List URL or ID', i));
        readSource = () => {
          const m = i.value.match(/(\d{3,})/);
          if (!m) throw new Error('Enter a list URL or its numeric ID.');
          return { list: m[1] };
        };
        break;
      }
      case 'community': {
        const i = text(p.community, { placeholder: 'https://x.com/i/communities/1234567890' });
        add(field('Community URL or ID', i));
        readSource = () => {
          const m = i.value.match(/(\d{3,})/);
          if (!m) throw new Error('Enter a community URL or its numeric ID.');
          return { community: m[1] };
        };
        break;
      }
      case 'user': {
        const i = text(p.handle, { placeholder: '@handle' });
        const tab = select([['posts', 'Posts'], ['replies', 'Posts & replies'], ['media', 'Media']], p.tab || 'posts');
        add(field('Account', i), field('Show', tab));
        readSource = () => {
          if (!isValidHandle(i.value)) throw new Error('Enter a valid @handle.');
          return { handle: cleanHandle(i.value), tab: tab.value };
        };
        break;
      }
      case 'likes': {
        const i = text(p.handle, { placeholder: '@yourhandle' });
        add(field('Account', i, 'X only shows likes for your own account.'));
        readSource = () => {
          if (!isValidHandle(i.value)) throw new Error('Enter a valid @handle.');
          return { handle: cleanHandle(i.value) };
        };
        break;
      }
      case 'explore': {
        const s = select(EXPLORE_TABS, p.exploreTab || 'trending');
        add(field('Tab', s));
        readSource = () => ({ exploreTab: s.value });
        break;
      }
      case 'custom': {
        const i = text(p.url, { placeholder: 'https://x.com/...' });
        add(field('x.com URL', i, 'Any x.com page: a post thread, a Space, a topic, a hashtag search...'));
        readSource = () => {
          const u = safeXUrl(i.value);
          if (!u) throw new Error('Enter an https://x.com/... URL.');
          return { url: u };
        };
        break;
      }
      default:
        add(h('p', { class: 'muted' }, 'No options needed for this column.'));
        readSource = () => ({});
    }
  }

  // Type picker (new columns only).
  const typeCards = COLUMN_TYPES.map((t) => {
    const b = h('button', {
      type: 'button', class: `type-card${t.type === typeSel ? ' on' : ''}`,
      onclick: () => {
        typeSel = t.type;
        for (const c of typeCards) c.classList.toggle('on', c === b);
        renderSource();
        error.hidden = true;
      },
    }, icon(t.icon, 20), h('span', null, h('strong', null, t.label), h('small', null, t.desc)));
    return b;
  });

  // Display options.
  const title = text(draft.title, { placeholder: 'Automatic' });
  const width = select(WIDTH_CHOICES, draft.width);
  const refresh = select(REFRESH_CHOICES, draft.refreshSec);
  const refreshMode = select(REFRESH_METHODS, draft.refreshMode);
  const notify = check('Desktop alert for new posts in this column', draft.notify);

  // Filters.
  const f = draft.filters;
  const include = area(f.include, { placeholder: 'Only show posts containing any of these. Comma or newline separated; /regex/ allowed.' });
  const exclude = area(f.exclude, { placeholder: 'Hide posts containing any of these.' });
  const users = text(f.excludeUsers, { placeholder: '@handle1, @handle2' });
  const lang = text(f.lang, { placeholder: 'en, es' });
  const checks = {
    onlyMedia: check('Only posts with media', f.onlyMedia),
    onlyLinks: check('Only posts with links', f.onlyLinks),
    hideReplies: check('Hide replies', f.hideReplies),
    hideReposts: check('Hide reposts', f.hideReposts),
    hideQuotes: check('Hide quote posts', f.hideQuotes),
    onlyVerified: check('Only verified accounts', f.onlyVerified),
    hideVerified: check('Hide verified accounts', f.hideVerified),
    dedupe: check('Hide posts already shown in another column', f.dedupe),
  };
  const minLikes = number(f.minLikes);
  const minReposts = number(f.minReposts);
  const minReplies = number(f.minReplies);
  const activeFilters = Object.keys(DEFAULT_FILTERS).filter((k) => f[k] && f[k] !== DEFAULT_FILTERS[k]).length;

  const display = section('Display',
    h('div', { class: 'row' }, field('Title', title), field('Width', width)),
    h('div', { class: 'row' }, field('Auto refresh', refresh, 'Waits while you hover, scroll down or type in the column, then retries every 5 seconds.'), field('Refresh method', refreshMode)),
    notify.el,
    h('small', { class: 'hint' }, 'Alerts and unread counts work while the XDeck tab is open.'));

  const filters = h('details', { class: 'form-section filters', open: activeFilters > 0 },
    h('summary', null, h('h3', null, `Filters${activeFilters ? ` (${activeFilters} active)` : ''}`)),
    h('div', { class: 'row' }, field('Must include', include), field('Exclude words', exclude)),
    h('div', { class: 'row' }, field('Exclude accounts', users), field('Languages', lang, 'Codes like en, es, pt')),
    h('div', { class: 'check-grid' }, Object.values(checks).map((c) => c.el)),
    h('div', { class: 'row' }, field('Min likes', minLikes), field('Min reposts', minReposts), field('Min replies', minReplies)),
    h('small', { class: 'hint' }, 'Filters run on posts as they appear in the column. Global mute words live in Settings.'));

  renderSource();

  const form = h('div', { class: 'editor-form' }, section('Source', sourceBox), display, filters, error);
  const body = isNew
    ? h('div', { class: 'editor' }, h('div', { class: 'type-grid', role: 'list' }, typeCards), form)
    : form;

  openDialog({
    title: isNew ? 'Add column' : 'Edit column',
    wide: isNew,
    body,
    actions: [
      !isNew && onDelete ? { label: 'Remove column', danger: true, left: true, onClick: () => onDelete() } : null,
      { label: 'Cancel' },
      {
        label: isNew ? 'Add column' : 'Save',
        primary: true,
        onClick: () => {
          let params;
          try {
            params = readSource();
          } catch (err) {
            error.textContent = err.message;
            error.hidden = false;
            return false;
          }
          const bad = termsError('Must include', include.value) || termsError('Exclude words', exclude.value);
          if (bad) {
            error.textContent = bad;
            error.hidden = false;
            return false;
          }
          const filtersOut = {
            include: include.value.trim(),
            exclude: exclude.value.trim(),
            excludeUsers: users.value.trim(),
            lang: lang.value.trim(),
            minLikes: +minLikes.value || 0,
            minReposts: +minReposts.value || 0,
            minReplies: +minReplies.value || 0,
          };
          for (const [k, c] of Object.entries(checks)) filtersOut[k] = c.input.checked;
          onSave(normalizeColumn({
            ...draft,
            type: typeSel,
            params,
            title: title.value.trim().slice(0, 60),
            width: width.value,
            refreshSec: +refresh.value,
            refreshMode: refreshMode.value,
            notify: notify.input.checked,
            filters: filtersOut,
          }));
          return true;
        },
      },
    ].filter(Boolean),
  });
}

// ---------- settings ----------

export function openSettings({ settings, onChange, onExport, onImport, onReset }) {
  const s = structuredClone(settings);
  const commit = () => onChange(structuredClone(s));
  const bind = (el, key, read) => {
    el.addEventListener('change', () => { s[key] = read(el); commit(); });
    return el;
  };
  const bindCheck = (label, obj, key) => {
    const c = check(label, obj[key]);
    c.input.addEventListener('change', () => { obj[key] = c.input.checked; commit(); });
    return c.el;
  };

  const theme = bind(select([['dark', 'Lights out (black)'], ['dim', 'Dim'], ['light', 'Light']], s.theme), 'theme', (el) => el.value);
  const accent = h('input', { type: 'color', class: 'color', value: s.accent, 'aria-label': 'Accent color' });
  accent.addEventListener('input', () => { s.accent = accent.value; commit(); });
  const swatches = h('div', { class: 'swatches' }, ACCENTS.map(([c, name]) => h('button', {
    type: 'button', class: 'swatch', title: name, 'aria-label': name, style: { background: c },
    onclick: () => { s.accent = c; accent.value = c; commit(); },
  })));
  const width = bind(select(WIDTH_CHOICES, s.columnWidth), 'columnWidth', (el) => el.value);
  const refresh = bind(select(REFRESH_CHOICES, s.autoRefreshSec), 'autoRefreshSec', (el) => +el.value);
  const mute = area(s.muteWords, { rows: 3, placeholder: 'Hidden in every column. Comma or newline separated; /regex/ allowed.' });
  const muteError = h('small', { class: 'form-error', role: 'alert', hidden: true });
  mute.addEventListener('change', () => {
    const bad = termsError('Mute words', mute.value);
    muteError.textContent = bad;
    muteError.hidden = !bad;
    if (bad) return; // keep the last valid list
    s.muteWords = mute.value.trim();
    commit();
  });

  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    try {
      if (f.size > IMPORT_LIMITS.bytes) throw new Error('that file is larger than 1 MB.');
      let data;
      try { data = JSON.parse(await f.text()); } catch { throw new Error('that file is not valid JSON.'); }
      if (await onImport(data)) close();
    } catch (err) {
      toast(`Import failed: ${err.message}`, 6000);
    }
  });

  const body = h('div', { class: 'settings' },
    section('Appearance',
      h('div', { class: 'row' }, field('Deck theme', theme), field('Default column width', width)),
      h('div', { class: 'field' }, h('span', null, 'Accent color'), h('div', { class: 'accent-row' }, accent, swatches)),
      h('small', { class: 'hint' }, 'Columns follow your X display settings (x.com > Settings > Accessibility, display and languages > Display). Use Cmd/Ctrl + and - to zoom the whole deck.')),
    section('Columns',
      field('Default auto refresh for new columns', refresh),
      bindCheck('Pause auto refresh while the pointer is over a column', s, 'pauseOnHover'),
      bindCheck('Open clicked posts in the reading pane (Alt+P)', s, 'readingPane'),
      bindCheck('Show unread counters', s, 'showUnread'),
      bindCheck('Load columns only when they scroll into view (saves memory)', s, 'lazyLoad'),
      bindCheck('Keep other workspaces running in the background (uses more memory)', s, 'keepWorkspacesAlive')),
    section('Clean X',
      h('div', { class: 'check-grid' },
        bindCheck('Hide promoted posts', s.clean, 'hidePromoted'),
        bindCheck('Hide "Who to follow" and suggestions', s.clean, 'hideWhoToFollow'),
        bindCheck('Hide view counts', s.clean, 'hideViews'),
        bindCheck('Hide the inline composer on Home', s.clean, 'hideComposer'),
        bindCheck('Hide For you / Following tabs on Home', s.clean, 'hideTopTabs'),
        bindCheck('Hide trends modules', s.clean, 'hideTrends'),
        bindCheck('Hide Premium upsells', s.clean, 'hidePremium'),
        bindCheck('Hide Grok buttons', s.clean, 'hideGrok')),
      bindCheck('Show filtered posts dimmed with the reason (to tune filters)', s, 'showFiltered'),
      bindCheck('Also apply Clean X, mute words and the collection button to normal x.com tabs', s, 'cleanRegularTabs')),
    section('Global mute words', mute, muteError,
      h('small', { class: 'hint' }, 'A /regex/ term must be short and simple: no group that repeats a repeat or an alternation, no backreferences, at most two repeats (* + {n,}). Unsafe patterns are refused.')),
    section('Data',
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: onExport }, icon('download', 16), ' Export workspaces'),
        h('button', { type: 'button', class: 'btn', onclick: () => file.click() }, icon('upload', 16), ' Import workspaces'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: async () => { if (await onReset()) close(); } }, 'Reset to defaults'),
        file),
      h('small', { class: 'hint' }, 'Export saves workspaces, columns, filters and settings as JSON. Collections export from the Collections panel.')));

  const { close } = openDialog({ title: 'Settings', body, actions: [{ label: 'Done', primary: true }] });
}

// ---------- help ----------

export function openHelp() {
  const keys = [
    ['Alt + 1...9', 'Focus column 1 to 9. Then X\'s own keys work inside it: j / k next / previous, l like, r reply, t repost, b bookmark, Enter open'],
    ['Alt + N', 'New post'],
    ['Alt + A', 'Add column'],
    ['Alt + S  or  /', 'Search X: Enter adds a search column (paste an x.com URL to add that page)'],
    ['Alt + R', 'Refresh all columns'],
    ['Alt + M', 'Mark all as read'],
    ['Alt + C', 'Collections'],
    ['Alt + L', 'Cycle layout: columns, grid, tabs'],
    ['Alt + P', 'Toggle the reading pane'],
    ['Alt + [  /  Alt + ]', 'Previous / next workspace'],
    ['?', 'This help'],
    ['Esc', 'Close menus, panels and dialogs'],
    ['Alt + Shift + X', 'Open XDeck from any tab (change at chrome://extensions/shortcuts)'],
  ];
  const tips = [
    'Columns are live x.com pages using your normal X login. If a column asks you to sign in, log in to x.com once in a regular tab and press Refresh.',
    'Drag a column header to reorder. Double-click a header to scroll to the top. The unread badge marks the column read.',
    'The bookmark-plus button on every post saves it to XDeck Collections, with tags, notes and Markdown/CSV/JSON export.',
    'Right-click any x.com page or link: "Add as an XDeck column". Select text on any site: "Search X in XDeck".',
    'Search columns accept X operators. Combine with column filters (min likes, media only, exclude words) for focused news monitoring.',
    'Turn on "Desktop alert" in a column to get notifications for new matching posts while the deck is open.',
  ];
  openDialog({
    title: 'Shortcuts and tips',
    body: h('div', { class: 'help' },
      h('table', { class: 'keys' }, h('tbody', null, keys.map(([k, d]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, d))))),
      h('h3', null, 'Tips'),
      h('ul', null, tips.map((t) => h('li', null, t)))),
    actions: [{ label: 'Close', primary: true }],
  });
}

// ---------- auto refresh for a whole workspace ----------

export function openRefreshDialog({ workspace, titleOf, onApply }) {
  const rows = workspace.columns.map((col) => ({
    id: col.id,
    title: titleOf(col),
    sec: select(REFRESH_CHOICES, col.refreshSec, { class: 'input input-sm', 'aria-label': `Interval for ${titleOf(col)}` }),
    mode: select(REFRESH_METHODS, col.refreshMode, { class: 'input input-sm', 'aria-label': `Method for ${titleOf(col)}` }),
  }));
  const keep = ['', 'Keep each column as it is'];
  const allSec = select([keep, ...REFRESH_CHOICES], '', { class: 'input input-sm', 'aria-label': 'Interval for all columns' });
  const allMode = select([keep, ...REFRESH_METHODS], '', { class: 'input input-sm', 'aria-label': 'Method for all columns' });
  allSec.addEventListener('change', () => { if (allSec.value !== '') for (const r of rows) r.sec.value = allSec.value; });
  allMode.addEventListener('change', () => { if (allMode.value !== '') for (const r of rows) r.mode.value = allMode.value; });

  const body = rows.length
    ? h('div', { class: 'refresh-table' },
      h('p', { class: 'hint' }, `Each column refreshes on its own timer; the countdown shows in its header. A refresh waits while you hover, scroll down or type in that column, then retries every 5 seconds. Intervals under a minute work best with "Load new posts"; "Reload the page" loads X's page each time.`),
      h('div', { class: 'refresh-row refresh-all' }, h('strong', null, `All columns in "${workspace.name}"`), allSec, allMode),
      rows.map((r) => h('div', { class: 'refresh-row' }, h('span', { class: 'refresh-name', title: r.title }, r.title), r.sec, r.mode)))
    : h('p', { class: 'muted' }, 'This workspace has no columns yet.');

  openDialog({
    title: `Auto refresh: ${workspace.name}`,
    wide: true,
    body,
    actions: [
      { label: 'Cancel' },
      rows.length ? {
        label: 'Save',
        primary: true,
        onClick: () => onApply(rows.map((r) => ({ id: r.id, refreshSec: +r.sec.value, refreshMode: r.mode.value }))),
      } : null,
    ].filter(Boolean),
  });
}
