// XDeck shell loader. Runs at document_start on https://x.com/i/xdeck (top
// frame only) and turns that x.com page into the deck. The deck and its column
// iframes are then all same-origin x.com pages: X's login cookies (including
// the SameSite=Lax CSRF cookie) work normally and no security headers need to
// be touched.
//
// X's own app must not run here. The page is left to finish parsing (aborting
// it with window.stop() leaves Chrome's rendering paused), but every <script>,
// <style> and <link> the parser inserts is defused first: the HTML parser runs
// pending microtasks, including this MutationObserver, right before it executes
// a script. When parsing completes the deck replaces X's markup and imports
// its modules (src/*.js, web-accessible) into this isolated world.

(function () {
  'use strict';
  if (window.top !== window || globalThis.__xdeckLoader) return; // never nest the deck
  globalThis.__xdeckLoader = true;

  const doc = document;
  const OURS = 'data-xdeck';

  const defuse = (n) => {
    if (n.hasAttribute && n.hasAttribute(OURS)) return;
    if (n.tagName === 'SCRIPT') { n.type = 'text/x-xdeck-blocked'; n.remove(); }
    else if (n.tagName === 'STYLE' || n.tagName === 'LINK' || (n.tagName === 'META' && n.httpEquiv)) n.remove();
  };
  const guard = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        defuse(n);
        if (n.querySelectorAll) n.querySelectorAll('script, style, link, meta[http-equiv]').forEach(defuse);
      }
    }
  });
  guard.observe(doc.documentElement || doc, { childList: true, subtree: true });

  const el = (tag, attrs = {}, ...children) => {
    const node = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v === true ? '' : v);
    node.append(...children);
    return node;
  };

  function build() {
    guard.takeRecords().forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1) defuse(n); }));
    guard.disconnect();
    doc.querySelectorAll(`script, style, link:not([${OURS}])`).forEach((n) => n.remove());

    const html = doc.documentElement;
    for (const attr of [...html.attributes]) html.removeAttribute(attr.name);
    html.setAttribute('lang', 'en');
    html.setAttribute(OURS, 'shell');
    html.dataset.theme = 'dark';

    const head = doc.head || html.insertBefore(doc.createElement('head'), html.firstChild);
    head.replaceChildren(
      el('meta', { charset: 'utf-8' }),
      el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      el('title', {}, 'XDeck'));

    const body = doc.body || html.appendChild(doc.createElement('body'));
    for (const attr of [...body.attributes]) body.removeAttribute(attr.name);
    body.replaceChildren(
      el('div', { class: 'app' },
        el('nav', { class: 'rail', id: 'rail', 'aria-label': 'XDeck' }),
        el('div', { class: 'main' },
          el('header', { class: 'topbar', id: 'topbar' }),
          el('div', { class: 'banner', id: 'banner', role: 'alert', hidden: true }),
          el('div', { class: 'stage' },
            el('div', { class: 'workspaces', id: 'workspaces' }),
            el('aside', { class: 'reader', id: 'reader', 'aria-label': 'Reading pane', hidden: true })))),
      el('div', { class: 'composer', id: 'composer', role: 'dialog', 'aria-label': 'New post', hidden: true }),
      el('aside', { class: 'drawer', id: 'drawer', 'aria-label': 'Collections', hidden: true }));

    // Favicon as a data: URL (X's CSP allows data: images, not chrome-extension:).
    fetch(chrome.runtime.getURL('icons/icon32.png'))
      .then((r) => r.blob())
      .then((b) => new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(b); }))
      .then((href) => head.appendChild(el('link', { rel: 'icon', href, [OURS]: 'icon' })))
      .catch(() => {});

    import(chrome.runtime.getURL('src/deck.js')).catch((err) => {
      console.error('XDeck failed to start', err);
      const banner = doc.getElementById('banner');
      banner.textContent = `XDeck failed to start: ${err && err.message ? err.message : err}. Reload the page or the extension.`;
      banner.hidden = false;
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})();
