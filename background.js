// XDeck service worker.
// - Opens (or focuses) the deck tab at https://x.com/i/xdeck.
// - Lets the deck's columns load: X sends X-Frame-Options: DENY to logged-in
//   sessions, so while a deck tab is open a session rule removes X's
//   anti-framing headers from x.com pages that x.com loads in frames, in that
//   one tab only. Normal x.com tabs and every other site keep their headers.
// - Relays desktop notifications for keyword alerts and keeps the badge in sync.
// - Context menus: add an x.com page/link as a column, search a selection.

const DECK_URL = 'https://x.com/i/xdeck';
// twitter.com links still get the "add as column" menu (they redirect to x.com);
// no host permission is needed for menu patterns.
const X_PATTERNS = ['https://x.com/*', 'https://twitter.com/*'];

// ---------- deck tab ----------

async function openDeck() {
  const [tab] = await chrome.tabs.query({ url: `${DECK_URL}*` });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return tab.id;
  }
  const created = await chrome.tabs.create({ url: DECK_URL });
  return created.id;
}

chrome.action.onClicked.addListener(() => { openDeck(); });

async function deckTabs() {
  const { deckTabs: ids = [] } = await chrome.storage.session.get('deckTabs');
  return new Set(ids);
}

async function setDeckTabs(set) {
  await chrome.storage.session.set({ deckTabs: [...set] });
}

// ---------- framing rule (deck tab only) ----------

const FRAME_RULE_ID = 1;

async function setFrameRule(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [FRAME_RULE_ID],
    addRules: tabId == null ? [] : [{
      id: FRAME_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' },
        ],
      },
      condition: {
        requestDomains: ['x.com'],
        initiatorDomains: ['x.com'],
        resourceTypes: ['sub_frame'],
        tabIds: [tabId],
      },
    }],
  });
}

// One deck at a time: two deck tabs would overwrite each other's workspaces.
// The newest deck wins; older ones pause and offer to take over again.
let deckQueue = Promise.resolve();
function serialized(fn) {
  const run = deckQueue.then(fn);
  deckQueue = run.catch(() => {});
  return run;
}

function claimDeck(tabId) {
  return serialized(async () => {
    const ids = await deckTabs();
    for (const id of ids) {
      if (id !== tabId) chrome.tabs.sendMessage(id, { type: 'deckSuperseded' }, { frameId: 0 }).catch(() => {});
    }
    await setDeckTabs(new Set([tabId]));
    await setFrameRule(tabId);
  });
}

function releaseDeck(tabId) {
  return serialized(async () => {
    const ids = await deckTabs();
    if (!ids.delete(tabId)) return;
    await setDeckTabs(ids);
    await setFrameRule(null);
    chrome.action.setBadgeText({ text: '' });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => { releaseDeck(tabId); });

// The deck tab navigated somewhere else: drop the rule for it.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && info.status !== 'loading') return;
  const url = info.url || (tab && tab.url) || '';
  if (!url.startsWith(DECK_URL)) releaseDeck(tabId);
});

// ---------- inbox (the deck consumes it on load and on change) ----------

async function pushInbox(item) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await chrome.storage.local.set({ [`inbox:${id}`]: { ...item, at: Date.now() } });
}

// ---------- notifications ----------

async function notify({ title, message, contextMessage, url }) {
  const id = `xd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await chrome.storage.session.set({ [id]: url || '' });
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: String(title || 'XDeck').slice(0, 120),
    message: String(message || '').slice(0, 300),
    contextMessage: contextMessage ? String(contextMessage).slice(0, 80) : undefined,
    priority: 0,
  });
}

chrome.notifications.onClicked.addListener(async (id) => {
  const data = await chrome.storage.session.get(id);
  chrome.notifications.clear(id);
  chrome.storage.session.remove(id);
  if (data[id]) await pushInbox({ action: 'openDetail', url: data[id] });
  await openDeck();
});

chrome.notifications.onClosed.addListener((id) => { chrome.storage.session.remove(id); });

// ---------- badge ----------

function setBadge(count) {
  chrome.action.setBadgeBackgroundColor({ color: '#1d9bf0' });
  chrome.action.setBadgeText({ text: count > 0 ? (count > 99 ? '99+' : String(count)) : '' });
}

// ---------- messages from the deck page ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // A prerendered or cached deck page must not claim the tab; tell it to wait.
  if (msg && msg.type === 'registerDeck' && sender.id === chrome.runtime.id
      && typeof sender.url === 'string' && sender.url.startsWith(DECK_URL)
      && sender.documentLifecycle && sender.documentLifecycle !== 'active') {
    sendResponse({ ok: false, error: 'not-active' });
    return false;
  }
  const fromDeck = sender.id === chrome.runtime.id && sender.frameId === 0
    && typeof sender.url === 'string' && sender.url.startsWith(DECK_URL);
  if (!fromDeck) return false;
  switch (msg && msg.type) {
    case 'registerDeck':
      if (!sender.tab || sender.tab.id < 0) { sendResponse({ ok: false }); break; }
      claimDeck(sender.tab.id).then(
        () => sendResponse({ ok: true }),
        (err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }),
      );
      return true;
    case 'notify':
      notify(msg);
      break;
    case 'badge':
      setBadge(msg.count | 0);
      break;
    default:
      break;
  }
  return false;
});

// ---------- context menus ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'xd-add-page', title: 'Add this page as an XDeck column',
      contexts: ['page'], documentUrlPatterns: X_PATTERNS,
    });
    chrome.contextMenus.create({
      id: 'xd-add-link', title: 'Add link as an XDeck column',
      contexts: ['link'], targetUrlPatterns: X_PATTERNS,
    });
    chrome.contextMenus.create({
      id: 'xd-search', title: 'Search X in XDeck for "%s"', contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'xd-add-page') {
    await pushInbox({ action: 'addColumn', url: info.frameUrl || info.pageUrl });
  } else if (info.menuItemId === 'xd-add-link') {
    await pushInbox({ action: 'addColumn', url: info.linkUrl });
  } else if (info.menuItemId === 'xd-search') {
    await pushInbox({ action: 'addSearch', query: String(info.selectionText || '').trim().slice(0, 500) });
  } else {
    return;
  }
  await openDeck();
});
