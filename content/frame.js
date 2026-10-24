// XDeck in-frame controller. Runs in every x.com frame at document_start
// (except the deck shell itself, https://x.com/i/xdeck).
//
// Inside a deck iframe (direct parent is the same-origin deck shell):
//   compact layout, column filters, clean mode, auto refresh, unread/alert
//   reporting, reading-pane clicks, "save to collection" button, Alt-key
//   shortcut forwarding.
// In a normal x.com tab: only when settings.cleanRegularTabs is on (clean mode,
//   global mute words, collection button).
//
// Deck <-> frame messages use window.postMessage with { ns: 'xdeck', type, ... };
// both sides check origin and source. Settings come from chrome.storage.local.

(function () {
  'use strict';
  const Core = globalThis.XDeckCore;
  if (!Core || globalThis.__xdeckFrame || !chrome.runtime || !chrome.runtime.id) return;
  globalThis.__xdeckFrame = true;

  const isTop = window.top === window;
  let inDeck = false;
  if (!isTop) {
    try {
      inDeck = window.parent === window.top
        && window.parent.location.origin === location.origin
        && window.parent.location.pathname.startsWith('/i/xdeck');
    } catch { inDeck = false; }
  }
  if (!inDeck && !isTop) return;

  const root = document.documentElement;
  const ARM_DELAY = 4000;
  const WTF_RE = /who to follow|you might like|relevant people|suggested for you|topics to follow|creators for you/i;
  const TRENDS_RE = /trending|what.s happening/i;

  const state = {
    role: inDeck ? 'column' : 'tab',  // column | detail | compose | tab
    column: null,                     // column config sent by the deck
    settings: null,
    cf: null,                         // compiled filters
    collected: new Set(),
    seen: new Set(),                  // posts seen on the column's own (chronological) page
    owned: new Set(),                 // posts shown here and reported to the deck (de-duplication)
    watermark: 0,                     // newest post time seen on the column's own page
    baseMark: 0,                      // the deck's remembered watermark for this column
    markApplied: false,
    searchTabDone: false,
    settleUntil: 0,                   // ignore posts for unread/ownership until X finishes switching tabs
    armed: false,
    armTimer: null,
    dupIds: new Set(),
    hovered: false,
    atTop: true,
    href: location.href,
    stack: [location.href],
    homeTabDone: false,
    rootClasses: new Set(inDeck ? ['xdeck-frame'] : []),
    observer: null,
    navTimer: null,
  };

  syncRootClasses();

  // ---------- messaging ----------

  function send(msg) {
    if (!inDeck) return;
    try { window.parent.postMessage({ ns: 'xdeck', ...msg }, location.origin); } catch { /* deck gone */ }
  }

  function alive() {
    try { return !!chrome.runtime.id; } catch { return false; }
  }

  window.addEventListener('message', (e) => {
    if (!inDeck || e.origin !== location.origin || e.source !== window.parent) return;
    const m = e.data;
    if (!m || m.ns !== 'xdeck') return;
    switch (m.type) {
      case 'config': {
        const prev = state.column;
        state.role = m.role || 'column';
        state.column = m.column || null;
        applySettings();
        // Saving the column (title, width, filters) must not reset the page state or
        // re-force Following/Latest; only a different page or timeline choice does.
        const same = !!(prev && state.column && prev.url === state.column.url
          && (prev.params || {}).homeTab === (state.column.params || {}).homeTab
          && (prev.params || {}).mode === (state.column.params || {}).mode);
        // The deck remembers the newest post this column has shown, so a
        // reloaded column (refresh mode "reload") still detects new posts.
        // Applied in scan() once the column's own page is showing.
        state.baseMark = +m.mark || 0;
        if (!same) {
          if (prev) resetPageState();
          state.markApplied = false;
          state.homeTabDone = false;
          state.searchTabDone = false;
        }
        scheduleScan();
        break;
      }
      case 'refresh': refreshNow(); break;
      case 'autoRefresh': {
        // The deck owns the timers; the frame only says whether now is a good moment.
        const why = refreshBlocker();
        if (!why) refreshNow();
        send({ type: 'refreshResult', done: !why, reason: why });
        break;
      }
      case 'top': window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'back': goBack(); break;
      case 'navigate': resetPageState(); spaNavigate(m.url); break;
      case 'dups':
        if (m.reset) state.dupIds.clear();
        (m.ids || []).forEach((id) => state.dupIds.add(String(id)));
        capSet(state.dupIds, 4000);
        scheduleScan();
        break;
      default: break;
    }
  });

  send({ type: 'hello', href: location.href });

  // ---------- settings & collections ----------
  // Default clean classes go on synchronously (end of file); stored settings refine them.

  chrome.storage.local.get(['settings', 'collections']).then(({ settings, collections }) => {
    state.settings = settings || {};
    state.collected = new Set((collections || []).map((c) => c.id));
    applySettings();
    scheduleScan();
  }).catch(() => {});

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      state.settings = changes.settings.newValue || {};
      applySettings();
      scheduleScan();
    }
    if (changes.collections) {
      state.collected = new Set((changes.collections.newValue || []).map((c) => c.id));
      for (const b of document.querySelectorAll('.xd-collect')) b.classList.toggle('on', state.collected.has(b.dataset.id));
    }
  });

  function cleanActive() {
    return inDeck || !!(state.settings && state.settings.cleanRegularTabs);
  }

  function setRootClass(cls, on) {
    if (on) state.rootClasses.add(cls); else state.rootClasses.delete(cls);
    root.classList.toggle(cls, on);
  }

  function syncRootClasses() {
    for (const cls of state.rootClasses) if (!root.classList.contains(cls)) root.classList.add(cls);
  }

  function applySettings() {
    const s = state.settings || {};
    const c = s.clean || {};
    const active = cleanActive();
    const def = (v, d) => (v === undefined ? d : !!v);
    setRootClass('xdeck-clean', active);
    setRootClass('xd-h-promoted', active && def(c.hidePromoted, true));
    setRootClass('xd-h-wtf', active && def(c.hideWhoToFollow, true));
    setRootClass('xd-h-views', active && def(c.hideViews, false));
    setRootClass('xd-h-composer', active && def(c.hideComposer, true));
    setRootClass('xd-h-trends', active && def(c.hideTrends, true));
    setRootClass('xd-h-premium', active && def(c.hidePremium, true));
    setRootClass('xd-h-grok', active && def(c.hideGrok, true));
    setRootClass('xd-h-toptabs', inDeck && def(c.hideTopTabs, false));
    setRootClass('xd-show-filtered', active && !!s.showFiltered);
    if (state.role === 'column') state.cf = Core.compileFilters(state.column ? state.column.filters : {}, s.muteWords || '');
    else if (state.role === 'tab') state.cf = active ? Core.compileFilters({}, s.muteWords || '') : null;
    else state.cf = null;
    setActive(active);
  }

  // Observe the page only where XDeck does something: deck frames, or normal
  // tabs with cleanRegularTabs. Turning that off restores the page.
  function setActive(on) {
    if (on && !state.observer) {
      state.observer = new MutationObserver(scheduleScan);
      state.observer.observe(root, { childList: true, subtree: true });
      state.navTimer = setInterval(checkNav, 400);
      scheduleScan();
    } else if (!on && state.observer) {
      state.observer.disconnect();
      state.observer = null;
      clearInterval(state.navTimer);
      state.navTimer = null;
      for (const n of document.querySelectorAll('[data-xd-hide]')) n.removeAttribute('data-xd-hide');
      for (const n of document.querySelectorAll('[data-xd-kind]')) n.removeAttribute('data-xd-kind');
      for (const n of document.querySelectorAll('.xd-collect')) n.remove();
    }
  }

  function capSet(set, max) {
    if (set.size <= max) return;
    let drop = set.size - Math.floor(max * 0.75);
    for (const v of set) { set.delete(v); if (--drop <= 0) break; }
  }

  // ---------- scanning ----------

  // Scan before the next paint so filtered posts never flash; the timer keeps
  // scanning (unread counts, alerts) while the deck tab is in the background,
  // where animation frames don't run.
  let scanQueued = false;
  let scanRaf = 0;
  let scanTimer = 0;
  function runScan() {
    if (!scanQueued) return;
    scanQueued = false;
    cancelAnimationFrame(scanRaf);
    clearTimeout(scanTimer);
    scan();
  }
  function scheduleScan() {
    if (scanQueued) return;
    scanQueued = true;
    scanRaf = requestAnimationFrame(runScan);
    scanTimer = setTimeout(runScan, 250);
  }

  function analyze(article) {
    const href = Core.permalink(article);
    const cached = article.__xd;
    if (cached && cached.href === href) {
      // X updates counters in place; re-read them so "min likes" and friends see current values.
      if (cached.post) cached.post.metrics = Core.metrics(article);
      return cached;
    }
    const promoted = Core.isPromoted(article);
    const result = { href, promoted, post: promoted ? null : Core.parseArticle(article) };
    if (href || promoted) article.__xd = result; // re-check posts that are still rendering
    return result;
  }

  function setHidden(cell, reason) {
    if (reason) { if (cell.dataset.xdHide !== reason) cell.dataset.xdHide = reason; }
    else if (cell.hasAttribute('data-xd-hide')) cell.removeAttribute('data-xd-hide');
  }

  function setKind(el, kind) {
    if (kind) { if (el.dataset.xdKind !== kind) el.dataset.xdKind = kind; }
    else if (el.hasAttribute('data-xd-kind')) el.removeAttribute('data-xd-kind');
  }

  function classifyNonPost(cell) {
    const h2 = cell.querySelector('h2');
    const heading = h2 ? h2.textContent : '';
    if (heading && WTF_RE.test(heading)) return 'wtf';
    if (heading && TRENDS_RE.test(heading)) return 'trends';
    if (cell.querySelector('a[href^="/i/connect_people"]')) return 'wtf';
    if (cell.querySelector('a[href^="/i/premium"], a[href^="/i/verified-choose"]')) return 'premium';
    if (cell.querySelector(Core.SEL.userCell)) {
      let prev = cell.previousElementSibling;
      for (let i = 0; prev && i < 10 && prev.querySelector(Core.SEL.userCell); i++) prev = prev.previousElementSibling;
      if (prev && prev.dataset.xdKind === 'wtf') return 'wtf';
    }
    return '';
  }

  // Columns whose own page lists posts newest-first; only these produce unread
  // counts and alerts (For you, Top, bookmarks, likes and explore are not).
  function isChronological() {
    const c = state.column;
    if (!c) return false;
    const p = c.params || {};
    switch (c.type) {
      case 'home': return p.homeTab !== 'foryou';
      case 'search': return (p.mode || 'live') === 'live';
      case 'notifications':
      case 'list':
      case 'user':
        return true;
      default:
        return false;
    }
  }

  function scan() {
    if (!alive()) return;
    bootStep();
    syncRootClasses();
    if (!cleanActive()) return;
    if (inDeck) { ensureHomeTab(); ensureSearchTab(); markComposer(); }
    const filtering = state.role === 'column' || state.role === 'tab';
    const onPage = state.role === 'column' && onColumnPage();
    const chrono = onPage && isChronological();
    if (chrono && !state.markApplied) {
      state.markApplied = true;
      if (state.baseMark) {
        state.watermark = Math.max(state.watermark, state.baseMark);
        clearTimeout(state.armTimer);
        state.armTimer = null;
        state.armed = true;
      }
    }
    const settling = Date.now() < state.settleUntil;
    if (settling) setTimeout(scheduleScan, Math.max(50, state.settleUntil - Date.now() + 50));
    const prevMark = state.watermark;
    const ids = [];
    const fresh = [];
    let sawPosts = false;
    // Position of the topmost post seen before this scan. A new post is above it (a
    // post loaded by scrolling down is below it), which also catches reposts, whose
    // time is the original post's, and posts X renders late from a larger batch.
    let anchorIdx = -1;
    let postIdx = 0;
    const cells = document.querySelectorAll(Core.SEL.cell);
    if (chrono && state.armed) {
      let i = 0;
      for (const cell of cells) {
        const a = cell.querySelector(Core.SEL.article);
        if (!a) continue;
        const info = analyze(a);
        if (info.promoted || !info.post) continue;
        if (state.seen.has(info.post.id)) { anchorIdx = i; break; }
        i++;
      }
    }
    for (const cell of cells) {
      const article = cell.querySelector(Core.SEL.article);
      if (!article) { setKind(cell, classifyNonPost(cell)); setHidden(cell, null); continue; }
      const { promoted, post } = analyze(article);
      if (promoted) { setKind(cell, 'promoted'); setHidden(cell, null); continue; }
      setKind(cell, '');
      if (!post) continue;
      const idx = postIdx++;
      sawPosts = true;
      ensureCollectButton(article, post);
      let reason = filtering && state.cf ? Core.evaluate(post, state.cf) : null;
      if (!reason && onPage && state.column.filters && state.column.filters.dedupe && state.dupIds.has(post.id)) reason = 'shown in another column';
      setHidden(cell, reason);
      // Only posts actually shown on the column's own page claim ownership for de-duplication.
      if (onPage && !settling && !reason && !state.owned.has(post.id)) {
        state.owned.add(post.id);
        ids.push(post.id);
      }
      if (chrono && !settling && !state.seen.has(post.id)) {
        state.seen.add(post.id);
        const t = Date.parse(post.time) || 0;
        if (t > state.watermark) state.watermark = t;
        if (state.armed && !reason && (t > prevMark || (anchorIdx >= 0 && idx < anchorIdx))) fresh.push(slim(post));
      }
    }
    if (chrono && sawPosts && !settling && !state.armed && !state.armTimer) {
      state.armTimer = setTimeout(() => { state.armed = true; state.armTimer = null; }, ARM_DELAY);
    }
    capSet(state.seen, 4000);
    capSet(state.owned, 4000);
    if (ids.length || fresh.length || state.watermark !== prevMark) {
      send({ type: 'posts', ids, fresh, mark: chrono ? state.watermark : 0 });
    }
  }

  function slim(p) {
    return {
      id: p.id, url: p.url, handle: p.handle, name: p.name,
      text: p.text.slice(0, 500), time: p.time, hasMedia: p.hasMedia,
    };
  }

  // The column moved to a different page (or a different column's page): what was
  // seen on the old one says nothing about the new one.
  function resetPageState() {
    state.seen.clear();
    state.owned.clear();
    state.watermark = 0;
    state.markApplied = false;
    state.searchTabDone = false;
    state.homeTabDone = false;
    clearTimeout(state.armTimer);
    state.armTimer = null;
    state.armed = false;
    state.settleUntil = Date.now() + 1500;
  }

  function disarm() {
    state.armed = false;
    clearTimeout(state.armTimer);
    state.armTimer = null;
  }

  // ---------- home tab / composer ----------

  function ensureHomeTab() {
    if (state.role !== 'column' || !state.column || state.column.type !== 'home' || location.pathname !== '/home') return;
    const tabs = [...document.querySelectorAll('[data-testid="primaryColumn"] [role="tablist"] [role="tab"]')];
    if (tabs.length < 2) return;
    const list = tabs[0].closest('[role="tablist"]');
    const container = list && (list.closest('nav') || list);
    if (container) setKind(container, 'toptabs');
    if (state.homeTabDone) return;
    state.homeTabDone = true;
    const wantForYou = state.column.params && state.column.params.homeTab === 'foryou';
    const re = wantForYou ? /for you|para ti|pour vous|para você|für dich/i : /following|siguiendo|abonnements|seguindo|folge ich|gefolgt/i;
    const target = tabs.find((t) => re.test(t.textContent)) || tabs[wantForYou ? 0 : 1];
    if (target && target.getAttribute('aria-selected') !== 'true') {
      // Posts from the tab shown before the switch don't count.
      target.click();
      state.seen.clear();
      state.owned.clear();
      state.watermark = state.baseMark;
      state.settleUntil = Date.now() + 1500;
      if (!state.baseMark) disarm();
    }
  }

  // X may ignore the f= parameter when it reaches the search page in-app and
  // open "Top". Pick the tab the column asks for by the tab link's own f=
  // value, which does not depend on the interface language. Runs once per
  // visit to the column's page, so tabs the user then clicks stay selected.
  function ensureSearchTab() {
    if (state.searchTabDone || state.role !== 'column' || !state.column || state.column.type !== 'search') return;
    if (location.pathname !== '/search' || !onColumnPage()) return;
    const tabs = [...document.querySelectorAll('[data-testid="primaryColumn"] [role="tablist"] a[role="tab"][href*="/search"]')];
    if (tabs.length < 2) return;
    state.searchTabDone = true;
    const want = (state.column.params && state.column.params.mode) || 'live';
    const fOf = (a) => new URL(a.getAttribute('href'), location.origin).searchParams.get('f') || 'top';
    const target = tabs.find((a) => fOf(a) === want);
    if (target && target.getAttribute('aria-selected') !== 'true') {
      target.click();
      state.seen.clear();
      state.owned.clear();
      state.settleUntil = Date.now() + 1500;
    }
  }

  function markComposer() {
    if (location.pathname !== '/home') return;
    const bar = document.querySelector('[data-testid="primaryColumn"] [data-testid="toolBar"]');
    if (!bar || bar.closest('[role="dialog"]') || !document.querySelector(Core.SEL.cell)) return;
    let node = bar;
    while (node.parentElement && node.parentElement !== document.body && !node.parentElement.querySelector(Core.SEL.cell)) node = node.parentElement;
    if (node.parentElement && node.parentElement !== document.body) setKind(node, 'composer');
  }

  // ---------- collection button ----------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function collectIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const body = document.createElementNS(SVG_NS, 'path');
    body.setAttribute('d', 'M6 3h12v18l-6-4.5L6 21Z');
    body.setAttribute('class', 'xd-body');
    const plus = document.createElementNS(SVG_NS, 'path');
    plus.setAttribute('d', 'M12 7v6M9 10h6');
    plus.setAttribute('class', 'xd-plus');
    svg.append(body, plus);
    return svg;
  }

  function ensureCollectButton(article, post) {
    const bar = Core.own(article, Core.SEL.actionBar);
    if (!bar) return;
    let btn = bar.querySelector(':scope > .xd-collect');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'xd-collect';
      btn.title = 'Save to XDeck collection';
      btn.setAttribute('aria-label', 'Save to XDeck collection');
      btn.appendChild(collectIcon());
      btn.addEventListener('click', onCollectClick);
      bar.appendChild(btn);
    }
    if (btn.dataset.id !== post.id) btn.dataset.id = post.id;
    btn.classList.toggle('on', state.collected.has(post.id));
  }

  async function onCollectClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!alive()) return;
    const article = e.currentTarget.closest(Core.SEL.article);
    const post = article && Core.parseArticle(article);
    if (!post) return;
    // The service worker applies every collection change, one at a time.
    const item = {
      id: post.id, url: post.url, handle: post.handle, name: post.name,
      text: post.text, quoteText: post.quoteText, time: post.time, links: post.links,
      hasMedia: post.hasMedia, metrics: post.metrics,
      savedAt: new Date().toISOString(), tags: [], note: '',
      source: (state.column && state.column.label) || location.pathname,
    };
    let res = null;
    try { res = await chrome.runtime.sendMessage({ type: 'collections', op: { kind: 'toggle', item } }); } catch { res = null; }
    if (!res || !res.ok) send({ type: 'collectFailed', error: String((res && res.error) || 'the extension did not answer') });
  }

  // ---------- reading pane ----------

  document.addEventListener('click', (e) => {
    if (state.role !== 'column' || !state.settings || !state.settings.readingPane) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    const article = target && target.closest(Core.SEL.article);
    if (!article) return;
    if (target.closest('[role="group"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="videoComponent"], [data-testid="card.wrapper"], button, [role="button"], input, textarea, .xd-collect')) return;
    if (String(window.getSelection ? window.getSelection() : '').length) return;
    let href = null;
    const a = target.closest('a[href]');
    if (a) {
      const h = a.getAttribute('href') || '';
      if (!/\/status\/\d+$/.test(h)) return; // profiles, hashtags, media and external links behave natively
      href = h;
    } else {
      const quote = target.closest(Core.SEL.quote);
      if (quote && article.contains(quote)) {
        const qa = quote.querySelector('a[href*="/status/"]');
        href = qa ? qa.getAttribute('href') : null;
      } else {
        href = Core.permalink(article);
      }
    }
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    send({ type: 'openDetail', url: new URL(href, location.origin).href });
  }, true);

  // ---------- navigation ----------

  function checkNav() {
    if (location.href === state.href) return;
    const href = location.href;
    const st = state.stack;
    if (isBootPage(state.href)) st.splice(0); // the boot page is not a place to go back to
    if (st.length > 1 && st[st.length - 2] === href) st.pop(); else st.push(href);
    if (st.length > 50) st.splice(0, st.length - 50);
    state.href = href;
    state.homeTabDone = false;
    state.searchTabDone = false;
    send({ type: 'nav', href, depth: st.length - 1 });
    scheduleScan();
  }

  // Back within this column only. Iframes share the tab's joint session
  // history, so history.back() could move another column or the reading pane.
  function goBack() {
    const st = state.stack;
    if (st.length > 1) spaNavigate(st[st.length - 2]);
    else send({ type: 'resetRequest' });
  }

  // In-app navigation without reloading X. Prefer X's own link for the path
  // (its router handles the click); otherwise replace the URL and let the
  // router pick it up from popstate. If neither renders the page, the deck
  // reloads the frame (through the boot page when X refuses that URL in frames).
  function findLink(path) {
    for (const a of document.querySelectorAll('a[href]')) if (a.getAttribute('href') === path) return a;
    return null;
  }

  function inAppGo(path, done) {
    const target = new URL(path, location.origin);
    const at = () => location.pathname === target.pathname && (!target.search || location.search === target.search);
    const primary = () => document.querySelector('[data-testid="primaryColumn"]');
    const snapshot = () => { const p = primary(); return p ? p.textContent.slice(0, 2000) : ''; };
    const statusId = (target.pathname.match(/\/status\/(\d+)/) || [])[1];
    const rendered = (before) => (statusId
      ? !!document.querySelector(`article a[href*="/status/${statusId}"]`)
      : snapshot() !== before);
    const viaPopstate = () => {
      const before = snapshot();
      history.replaceState({}, '', target.pathname + target.search + target.hash);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      checkNav();
      setTimeout(() => done(at() && rendered(before)), 2500);
    };
    const link = findLink(target.pathname + target.search);
    if (!link) { viaPopstate(); return; }
    link.click();
    setTimeout(() => { if (at()) { checkNav(); done(true); } else viaPopstate(); }, 1500);
  }

  function spaNavigate(url) {
    let u;
    try { u = new URL(url); } catch { return; }
    if (u.origin !== location.origin) return;
    if (u.href === location.href) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    inAppGo(u.pathname + u.search + u.hash, (ok) => { if (!ok) send({ type: 'navFailed', url: u.href }); });
  }

  // ---------- boot page ----------
  // Some x.com URLs are refused inside frames even with the deck's header rule
  // (seen for /home and /notifications in a logged-in session). The deck then
  // loads /i/xdk-boot?go=<path> instead, and this navigates there in-app.

  const BOOT_PATH = '/i/xdk-boot';
  const boot = { target: '', started: false };

  function isBootPage(href) {
    try { return new URL(href).pathname === BOOT_PATH; } catch { return false; }
  }

  if (inDeck && location.pathname === BOOT_PATH) {
    const go = new URLSearchParams(location.search).get('go') || '';
    if (/^\/(?!\/)/.test(go) && !/^\/i\/(xdeck|xdk-boot)/i.test(go)) boot.target = go;
  }

  if (boot.target) {
    setTimeout(() => {
      if (!boot.started) send({ type: 'bootFailed', url: location.origin + boot.target });
    }, 15000);
  }

  function bootStep() {
    if (!boot.target || boot.started) return;
    if (!document.querySelector('a[href="/home"], [data-testid="primaryColumn"]')) return; // X not rendered yet
    boot.started = true;
    inAppGo(boot.target, (ok) => { if (!ok) send({ type: 'bootFailed', url: location.origin + boot.target }); });
  }

  // ---------- auto refresh ----------

  function onColumnPage() {
    if (!state.column || !state.column.url) return false;
    try {
      const u = new URL(state.column.url);
      // Handles are case-insensitive: X may canonicalise /nasa to /NASA.
      if (location.pathname.toLowerCase() !== u.pathname.toLowerCase()) return false;
      if (u.pathname === '/search') return new URLSearchParams(location.search).get('q') === u.searchParams.get('q');
      return true;
    } catch { return false; }
  }

  // '' when a refresh may run now, otherwise why not: hover, scrolled, typing, dialog, offpage.
  function refreshBlocker() {
    const s = state.settings || {};
    if (state.hovered && s.pauseOnHover !== false) return 'hover';
    if (window.scrollY > 80) return 'scrolled';
    if (document.querySelector('[role="dialog"]')) return 'dialog';
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) return 'typing';
    return onColumnPage() ? '' : 'offpage';
  }
  const canRefresh = () => !refreshBlocker();

  function findNewPostsPill() {
    const nodes = document.querySelectorAll('[data-testid="pillLabel"], [data-testid="primaryColumn"] [role="button"], [data-testid="primaryColumn"] button');
    for (const el of nodes) {
      const t = el.textContent.trim();
      if (t.length < 40 && /^(show\s+\d+\s+(new\s+)?posts?|new posts?|\d+\s+new posts?)$/i.test(t)) return el.closest('button, [role="button"]') || el;
    }
    return null;
  }

  function refreshNow() {
    // A raw location.reload() of /home is refused inside frames; let the deck reload through its loader.
    if (state.column && state.column.refreshMode === 'reload') { send({ type: 'reloadRequest' }); return; }
    const pill = findNewPostsPill();
    if (pill) { pill.click(); return; }
    // X's own "load new posts" keyboard shortcut.
    const opts = { key: '.', code: 'Period', bubbles: true, cancelable: true };
    const target = document.body || root;
    target.dispatchEvent(new KeyboardEvent('keydown', opts));
    target.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  // ---------- hover, scroll, read state, shortcuts ----------

  let lastRead = 0;
  function markRead() {
    const now = Date.now();
    if (now - lastRead < 1500) return;
    lastRead = now;
    send({ type: 'read' });
  }

  root.addEventListener('mouseenter', () => { state.hovered = true; if (state.atTop) markRead(); });
  root.addEventListener('mouseleave', () => { state.hovered = false; });
  document.addEventListener('mousedown', () => { state.hovered = true; send({ type: 'focus' }); }, true);

  window.addEventListener('scroll', () => {
    const atTop = window.scrollY < 80;
    if (atTop !== state.atTop) { state.atTop = atTop; send({ type: 'scroll', atTop }); }
    if (atTop && state.hovered) markRead();
  }, { passive: true });

  const FORWARD = /^(Digit[1-9]|Key[NARMCLPS]|BracketLeft|BracketRight)$/;
  document.addEventListener('keydown', (e) => {
    if (!inDeck || !e.altKey || e.ctrlKey || e.metaKey || !FORWARD.test(e.code)) return;
    // Option/Alt + key types characters (ñ, ç, ¡...) on macOS: leave text input alone.
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    e.preventDefault();
    e.stopPropagation();
    send({ type: 'key', code: e.code, shift: e.shiftKey });
  }, true);

  applySettings();
})();
