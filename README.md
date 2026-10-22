# XDeck

A Chrome extension that turns X (x.com) into a TweetDeck-style workstation: live multi-column
decks, several layouts, per-column filters, keyword alerts, a reading pane, collections with
export, and a "clean X" mode. It brings together the most useful ideas from TweetDeck / X Pro,
Better TweetDeck and Control Panel for Twitter.

Author: Sergio Farfan

## How it works

- The deck lives at `https://x.com/i/xdeck`. When you open that page, XDeck stops X's own app
  from loading there and draws the deck instead.
- Every column is a live x.com page (Home, a search, a list, a profile...) shown in a compact
  layout. They use your normal X login, so likes, replies, reposts, media, DMs and the account
  switcher all work as usual.
- Because the deck and its columns are all x.com pages, X's login cookies work first-party. XDeck
  needs no X API key and costs nothing to run.
- X tells browsers not to show its pages inside frames (`X-Frame-Options: DENY` for logged-in
  sessions). While the deck tab is open, XDeck removes those anti-framing headers only from x.com
  pages that x.com itself loads in a frame, and only in that one tab. The rule is added when the
  deck opens and removed when the tab closes or navigates away. Normal x.com tabs and every other
  site keep their headers.
- Some pages (seen for Home and Notifications in a logged-in session) are still refused when loaded
  directly into a frame. XDeck then opens them through a small hop (`/i/xdk-boot?go=/home`) and
  navigates to the real page using X's own router, and remembers which paths need it. If X refuses
  even that, the column shows a card with Retry and Open in new tab instead of a blank page.
- An in-column script adds what X lacks: filters, unread tracking, alerts, the save-to-collection
  button and click-to-reading-pane. Everything XDeck stores stays in `chrome.storage.local` on your
  machine. Nothing is sent anywhere else.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this folder (`x-deck`).
3. Pin XDeck to the toolbar. Click the icon, press **Alt+Shift+X**, or visit `https://x.com/i/xdeck`.
4. If columns ask you to sign in, log in to x.com once in a normal tab, then press Refresh (Alt+R).

On a managed (corporate) Chrome profile, a policy may block unpacked extensions. If so, use a
personal profile.

## Features

**Deck and layouts**
- Multiple workspaces (for example "Main" and "News"). Rename, duplicate, reorder, import/export.
- Layouts: **Columns** (classic horizontal deck, per-column width), **Grid** (Auto rows by default: 1 row
  up to 3 columns, 2 rows up to 8, then 3; or pick 1 to 4 rows yourself. Fills the screen, good as a
  news wall. A single row of four looks the same as Columns, which is why Auto adds rows), **Tabs** (one large column at a time; good on a laptop).
- Drag column headers to reorder. Reordering and switching layouts never reload columns.
- **Reading pane**: when it's on, clicking a post opens the thread on the right while the column
  keeps its scroll position. The pane is resizable.
- **Composer** panel (Alt+N) uses X's own composer, including media, polls and scheduling.

**Column types**
Home (Following or For you), Notifications (all / verified / mentions), Search (Latest / Top /
Media / People), List, Profile (posts / replies / media), Bookmarks, Explore (trending, news,
sports, entertainment), Messages, Community, Likes, Grok, and any x.com URL.

**Search and news monitoring**
- Quick search in the top bar: Enter adds a "Latest" search column. Paste an x.com URL to add that
  page as a column.
- Advanced search builder: all/any/none words, exact phrase, hashtags, from/to/mentioning, list
  members, language, minimum likes/reposts/replies, news links, media, verified, date range.
- Presets: Breaking news, News links, Viral now, AI news, Media only. The news presets match links
  from eight major outlets by domain (`url:reuters.com OR url:apnews.com ...`). X's own
  `filter:news` returned nothing in a live test, so XDeck no longer uses it by default; it is still
  available in the builder. Keep queries to about 20 operators: X ignores anything past roughly 22
  (every `url:` and `OR` counts).
- Search columns open on the tab you pick (Latest by default) even when X opens on Top.

**Filters (per column, applied live)**
- Must include / exclude words (comma or newline separated, `/regex/` supported, word-boundary
  matching), exclude accounts (also hides their reposts), languages.
- Only media, only links, only verified, hide verified, hide replies, hide reposts, hide quotes.
- Minimum likes / reposts / replies.
- Hide posts already shown in another column of the workspace (de-duplication).
- Global mute words (Settings) apply to every column.
- "Show filtered posts dimmed" displays the reason a post was hidden, which helps when tuning
  filters.

**Clean X** (each option can be toggled)
Hide promoted posts, "Who to follow" and suggestion modules, view counts, the inline composer,
trends modules, Premium upsells and Grok buttons. Home columns open on the chronological
**Following** tab. Optionally apply the same cleanup (plus mute words) to normal x.com tabs.

**Unread, auto refresh, alerts**
- Unread counters per column, per workspace and on the toolbar icon. Scrolling a column to the top
  while hovering it, or clicking the badge, marks it read. Counters and alerts come from columns
  whose page is newest-first: Home (Following), Notifications, Latest searches, Lists and
  Profiles. For you, Top, Bookmarks, Likes and Explore are not chronological, so they are skipped.
- **Timed auto refresh, per column or per workspace.** Each column has its own interval (15 s up to
  1 hour) and method, set in Edit column. The timer icon in the top bar (or Right-click a workspace
  tab > Auto refresh...) opens one dialog for the whole workspace: set every column at once, then
  override any single column. The column header shows a live countdown ("next 0:42").
  - "Load new posts" is light and suits short intervals. "Reload the page" loads X's page each time
    and always works; prefer a minute or more with it.
  - A due refresh waits while you hover the column, scroll down in it, type in it or have a dialog
    open, shows "waiting", and retries every 5 seconds, so it fires soon after you move away.
  - The pause button in the top bar freezes every countdown ("paused") and resumes where it left
    off. It is not saved: reloading the deck turns refresh back on.
  - Refreshing by hand (the column's refresh button or Alt+R) restarts that column's countdown.
  - Timers run while the deck tab is open, including in the background. Chrome slows background
    tabs, so a refresh can arrive a little late.
- **Desktop alerts** per column for new posts that pass its filters. While the deck has focus,
  alerts show as in-page toasts instead. Clicking a notification opens the post in the reading pane.

**Collections**
- A bookmark-plus button in every post's action bar saves it to XDeck Collections, separate from
  X bookmarks.
- Add tags and notes, search, filter by tag, then export to Markdown, CSV or JSON. You can also copy
  a single post as Markdown.

**Right-click menus**
- On any x.com page or link: "Add as an XDeck column".
- On selected text on any website: "Search X in XDeck".

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Alt+1 ... Alt+9 | Focus column 1-9; then X's own keys work inside it (j/k, l like, r reply, t repost, b bookmark, Enter) |
| Alt+N | New post |
| Alt+A | Add column |
| Alt+S or / | Search X (Enter adds a column) |
| Alt+R | Refresh all columns |
| Alt+M | Mark all as read |
| Alt+C | Collections |
| Alt+L | Cycle layout |
| Alt+P | Toggle reading pane |
| Alt+[ / Alt+] | Previous / next workspace |
| ? | Shortcuts and tips |
| Esc | Close menus, panels and dialogs |
| Alt+Shift+X | Open XDeck from any tab (change at `chrome://extensions/shortcuts`) |

## Limits and caveats

- **One X account at a time.** All columns share one browser login. Switching accounts in one column
  switches all of them.
- **Memory.** Each column is a full x.com page. "Load columns only when they scroll into view" is on
  by default, and other workspaces are unloaded when you switch away (unless you enable "Keep other
  workspaces running").
- **Alerts and unread counts need the deck tab open.** It can be in the background.
- **Columns use X's theme and font size** (x.com > Settings > Accessibility, display and languages >
  Display). Use Cmd/Ctrl + and - to zoom the whole deck.
- **X changes its markup from time to time.** Every selector XDeck depends on lives in
  `content/core.js` (`SEL`) and `content/frame.css`. If X changes markup, filters or clean mode may
  stop matching until those are updated. The columns themselves keep working.
- Privacy: XDeck keeps everything in your browser and sends nothing anywhere. See [PRIVACY.md](PRIVACY.md).
- XDeck is an unofficial tool. It shows X's own pages and doesn't call X's private APIs, but X's
  terms still apply to how you use your account.

## Troubleshooting

- **A column shows "x.com refused to connect" or the card "X would not show this page in a
  column".** Press the column's refresh button or choose More > Reload column. If it keeps
  happening, open the deck tab's Console (Cmd+Option+J) and look for a line starting with
  "Refused to display 'https://x.com/...' in a frame because". That line names the header X is
  using.
- **Columns ask you to sign in.** Log in to x.com once in a normal tab, then press Alt+R.
- **Nothing happens when you open the deck.** Reload XDeck on `chrome://extensions`, then reload the
  deck tab. A banner at the top of the deck explains if the tab could not be prepared.

## Project layout

```
manifest.json          MV3 manifest
background.js          service worker: open deck, notifications, badge, context menus
deck.css               deck styles (injected on x.com/i/xdeck)
content/deck-loader.js takes over x.com/i/xdeck and boots the deck
content/core.js        post parser and filter engine (selectors in SEL)
content/frame.js       in-column controller: compact layout, filters, unread, alerts, collect
content/frame.css      compact column layout and clean-mode rules
src/deck.js            deck app: workspaces, columns, layouts, reading pane, composer, keys
src/columns.js         column types, URL building, search-query builder
src/store.js           settings, workspaces, collections (chrome.storage.local)
src/dialogs.js         add/edit column, settings, help
src/collections.js     collections drawer and exports
src/dom.js             DOM helpers (no innerHTML), icons, dialogs, menus, toasts
tools/make_icons.py    regenerates icons/ (no dependencies)
tests/                 Playwright unit and end-to-end tests with an X markup fixture
```

There is no build step: edit the files, then click the reload icon for XDeck on
`chrome://extensions` and reload the deck tab.

## Tests

```bash
npm install
```

```bash
npx playwright install chromium
```

```bash
npm test
```

- `tests/core.test.mjs` unit-tests the parser and filter engine against `tests/fixtures/x-timeline.html`.
- `tests/e2e.test.mjs` loads the extension in Chromium and serves X-like pages at `https://x.com/*`
  from a local HTTPS server (mapped with `--host-resolver-rules`, so Chrome's real network stack
  and the extension's header rule are exercised). Pages carry logged-in X's framing headers
  (`X-Frame-Options: DENY`, CSP `frame-ancestors 'none'`). It checks the deck takeover, columns
  loading in the deck tab but not in normal tabs, first-party SameSite=Lax cookies, filters, clean
  mode, unread, alerts, collections, reading pane, layouts, dialogs and persistence. It needs
  `openssl` on the PATH. Screenshots go to `tests/out/`.
- Real X answers headless browsers with HTTP 403, so behavior with a live, logged-in session is
  verified by hand in Chrome.

## Packaging

```bash
npm run zip
```

This creates `xdeck.zip` with only the extension files, ready for the Chrome Web Store or for
sharing.

## License

MIT. See [LICENSE](LICENSE).
