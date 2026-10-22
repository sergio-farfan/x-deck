# Chrome Web Store: Store listing tab

Copy each field into the Developer Dashboard. Images are in `store/out/`
(regenerate with `node store/make-assets.mjs`).

## Product details

**Title / Summary:** taken from `manifest.json` (XDeck; "Multi-column deck for X: live columns,
layouts, filters, keyword alerts, collections and a clean reading mode."). Nothing to enter.

**Description** (paste everything between the lines):

---

XDeck turns X (x.com) into a multi-column workspace, in the spirit of TweetDeck. Follow your timeline, notifications, searches, lists and profiles side by side. Every column is a live x.com page that uses your normal X login, so liking, replying, reposting, media and messages work as usual.

XDeck is an independent, unofficial tool. It is not affiliated with, endorsed by or sponsored by X Corp. You need an X account.

COLUMNS
- Home (Following or For you), Notifications (all, verified or mentions), Search, List, Profile, Bookmarks, Explore, Messages, Community, Likes, Grok, or any x.com page.
- Search columns accept X search operators, with an advanced search builder and ready-made presets for breaking news, news links, viral posts and AI news.

LAYOUTS AND WORKSPACES
- Columns (a horizontal deck with per-column widths), Grid (fills the screen, good as a news wall) or Tabs (one large column at a time).
- Several workspaces, for example "Main" and "News". Drag to reorder columns. Switching layouts never reloads your columns.
- Reading pane: open a post on the right while the column keeps its place.

FILTERS
- Per column: must-include words, excluded words, excluded accounts, languages, media only, links only, hide replies, reposts or quote posts, verified only, minimum likes, reposts or replies.
- Hide posts that already appear in another column.
- Global mute words for every column. Regular expressions are supported.

CLEAN X
- Hide promoted posts, "Who to follow" suggestions, view counts, trends modules, Premium upsells and Grok buttons. Each option can be turned on or off, and you can apply the same cleanup to normal x.com tabs.

STAY ON TOP OF NEW POSTS
- Timed auto refresh per column or for a whole workspace, from every 15 seconds to every hour, with a live countdown in each column header and a pause button. A refresh waits while you are reading a column.
- Unread counters per column, per workspace and on the toolbar icon.
- Optional desktop alerts for new posts that pass a column's filters.

COLLECTIONS
- Save any post with one click, add tags and notes, search them, and export to Markdown, CSV or JSON.

KEYBOARD AND MENUS
- Alt+1 to Alt+9 focus a column, then X's own keys work inside it. Shortcuts for new post, add column, search, refresh, mark read, layouts and workspaces.
- Right-click an x.com page or link to add it as a column, or select text on any site to search X for it.

PRIVACY
- XDeck keeps its settings, workspaces and saved posts only in your browser. It sends nothing to the developer or to any third party, contains no analytics or tracking, and does not use X's API or any API keys.

HOW IT WORKS
- The deck opens at x.com/i/xdeck. To show X's own pages as columns, XDeck removes X's anti-framing headers from x.com pages loaded inside that deck tab only, and only while it is open. Normal x.com tabs and all other websites are not affected.

LIMITS
- One X account at a time: all columns share your browser's X login.
- Each column is a full x.com page, so many columns use more memory. Columns load only when they scroll into view.
- Unread counts, alerts and auto refresh run while the deck tab is open.
- X changes its pages from time to time; filters and clean-up rules may need an update when it does.

---

**Category:** Social Media & Networking
(Alternative if you prefer: Workflow & Planning.)

**Language:** English (United States)

## Graphic assets

| Field | File | Notes |
|---|---|---|
| Store icon (128x128) | `store/out/icon-128.png` | 96x96 artwork with 16 px transparent padding, per the image guidelines |
| Global promo video | leave empty | optional |
| Screenshots (1280x800, up to 5) | Upload in this order: `screenshot-5-columns.jpg` (real News workspace, public posts), `screenshot-1-add-search-column.jpg`, `screenshot-2-settings-clean-x.jpg`, `screenshot-3-collections.jpg`, `screenshot-4-shortcuts.jpg` | 1-4 are generated from the real extension with an empty workspace and fictional saved posts |
| Small promo tile (440x280) | `store/out/promo-small-440x280.jpg` | |
| Marquee promo tile (1400x560) | `store/out/promo-marquee-1400x560.jpg` | optional; needed only for featured placement |

**Replacing screenshot 5 (real columns):** open the News workspace (public news posts, nothing personal), take a
screenshot of the browser page with Cmd+Shift+4 (drag over the page area), then run:

```bash
store/fit-screenshot.sh ~/Desktop/<your screenshot>.png store/out/screenshot-5-columns.jpg
```

It scales and crops to exactly 1280x800 JPEG. Make it the first screenshot in the dashboard.

## Additional fields

- **Official URL:** None. It only lists sites verified in Google Search Console; skip it.
- **Homepage URL:** `https://github.com/sergio-farfan/x-deck`
- **Support URL:** `https://github.com/sergio-farfan/x-deck/issues`
- **Mature content:** off.

## Other tabs

Privacy, Distribution and Test instructions: see `store/SUBMISSION.md`.
