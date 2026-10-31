<!--
XDeck
X post source for the project announcement.
Author: Sergio Farfan
-->

Announcement copy for X. The voice follows `dev-to-article.md`: the problem
first, in the first person, then what was built, then plain claims without
superlatives. Every variant below is within the 280-character limit; a link
counts as 23 characters on X whatever its length, and so does a bare domain
such as x.com/i/xdeck, which X turns into a link.

Post the single version or the thread, not both. The dev.to article is
published at https://dev.to/sergio_farfn_b071cafc7ed/xdeck-tweetdeck-style-columns-for-x-free-and-open-source-37f7.

Store: https://chromewebstore.google.com/detail/xdeck/bhbnoiglolaljelapgkljofdbcfaclcl
Code: https://github.com/sergio-farfan/x-deck

## Single post, recommended

TweetDeck went behind a paywall, so I built my own.

XDeck, a Chrome extension, turns X into a multi-column deck: live X columns with your login, filters, alerts, auto refresh, reading pane, saved posts. No API key, nothing leaves the browser. MIT.

https://chromewebstore.google.com/detail/xdeck/bhbnoiglolaljelapgkljofdbcfaclcl

## Single post, alternative, opens on the mechanism

Each XDeck column is a real X page. The deck runs on X too, at /i/xdeck, so your login just works, and a header rule scoped to that one tab lets X be framed there, nowhere else.

A TweetDeck-style deck for X as a Chrome extension. No API, no server, MIT.

https://chromewebstore.google.com/detail/xdeck/bhbnoiglolaljelapgkljofdbcfaclcl

## Thread

**1/** For years I read X in TweetDeck: searches, a list, notifications and
the timeline side by side, nothing recommended to me. Then it became X Pro
behind a subscription. So I built XDeck, a Chrome extension that turns X into
a multi-column deck again.

**2/** Every column is a live X page with your own login, so likes,
replies and DMs just work. No API key, no server. Around the columns: filters
that actually hide posts, unread counts, keyword alerts, timed refresh, a
reading pane, and collections you can export.

**3/** The hard part was not the UI. An extension page cannot host X
frames (Chrome withholds X's SameSite=Lax CSRF cookie), so the deck lives on
X itself at x.com/i/xdeck. One session rule, pinned to that tab, removes
X-Frame-Options for frames there and nowhere else.

**4/** Two bugs worth a write-up: one `overflow-x: hidden` on body made X's
virtual list think nobody scrolled, and "back" in a frame undoes the newest
entry of the whole tab, so XDeck traverses its own history with the
Navigation API only when that is safe.

**5/** Plain JavaScript, Manifest V3, no build step, 331 Playwright and node
checks against a local stand-in for x.com. Free, MIT.

Store: https://chromewebstore.google.com/detail/xdeck/bhbnoiglolaljelapgkljofdbcfaclcl
Code: https://github.com/sergio-farfan/x-deck
Write-up: https://dev.to/sergio_farfn_b071cafc7ed/xdeck-tweetdeck-style-columns-for-x-free-and-open-source-37f7

## Reply with the write-up (posted as a reply to the single post)

The write-up, a 4-minute read: what you get, how a Chrome extension shows X in columns without X's API, and the honest limits.

https://dev.to/sergio_farfn_b071cafc7ed/xdeck-tweetdeck-style-columns-for-x-free-and-open-source-37f7

## Images

Images do not count toward the character limit; attach up to four per post.
All are the Chrome Web Store images in `store/out/` (1280x800 JPEG):

- Single post: `screenshot-5-columns.jpg` (the real News workspace).
- Thread 1/: `screenshot-5-columns.jpg`.
- Thread 2/: `screenshot-1-add-search-column.jpg` and `screenshot-3-collections.jpg`.
- Thread 5/: `screenshot-2-settings-clean-x.jpg` and `screenshot-4-shortcuts.jpg`.
- Posts 3/ and 4/ are about the code; leave them without images so the text is
  what shows in the timeline.

Add alt text when attaching (X offers it under the image): "XDeck: four live X
columns side by side", "Add column dialog with the Breaking news search
preset", "Collections drawer with tags, notes and export", "Settings with Clean
X options", "Keyboard shortcuts".

## Notes

- XDeck is unofficial and not affiliated with X Corp; do not imply otherwise.
- Claim only what the release ships: "no API key", "nothing leaves the
  browser" and "MIT" are safe; "private" or "secure" are not claims to make.
- Do not name TweetDeck's price or X Premium tiers; "behind a subscription" is
  enough and does not go stale.
- Add the dev.to link to the single post only if it still fits: the store link
  already costs 23 characters, and so would the article link.
