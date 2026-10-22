# Chrome Web Store: Privacy, Distribution and Test instructions tabs

Store listing text and images: see `store/LISTING.md` and `store/out/`.
Package to upload: `xdeck.zip` (build with `npm run zip`).

## Privacy tab

**Single purpose description**

```
XDeck shows X (x.com) as a multi-column deck: several live x.com pages (timeline, notifications, searches, lists, profiles) side by side in one tab, with layouts, filters, auto refresh, unread counts, alerts and saved posts that support reading X in columns.
```

**Permission justifications**

storage:
```
Saves the user's deck setup (workspaces, columns, filters, settings) and the posts the user chooses to save, locally in chrome.storage.local. Nothing is sent off the device.
```

unlimitedStorage (only if the dashboard asks: packages from 0.1.1 on no longer request it; uploading
the current xdeck.zip removes this field. Version 0.1.2 also drops twitter.com host access):
```
Lets the user's saved-post collection grow beyond the default chrome.storage.local quota. Each saved post keeps its text, author, link, counts, tags and notes locally, and a long-running collection plus the deck setup can exceed the default limit. Data stays on the device and is never transmitted.
```

notifications:
```
Shows an optional desktop alert when a new post appears in a column for which the user turned alerts on. Off by default; enabled per column by the user.
```

contextMenus:
```
Adds right-click items: "Add this page as an XDeck column" on x.com pages and links, and "Search X in XDeck" for selected text, which opens a search column for that text.
```

declarativeNetRequestWithHostAccess:
```
X sends X-Frame-Options: DENY and a CSP frame-ancestors rule, which stop its pages from appearing as deck columns. While the user's deck tab (https://x.com/i/xdeck) is open, XDeck adds a session rule that removes those two response headers only for x.com pages loaded as frames by x.com, and only in that one tab (tabIds condition). The rule is removed when the tab closes or navigates away. Normal x.com tabs and all other sites keep their headers.
```

Host permission (https://x.com/*):
```
Runs the deck at https://x.com/i/xdeck and a content script in x.com pages shown as columns, to apply the user's filters and clean-up options, count unread posts and add the save button. Also required for the header rule above. XDeck requests no other host access.
```

**Are you using remote code?** No, I am not using remote code.
(All JavaScript is in the package; the deck's modules are loaded from the extension itself.)

**Data usage**

Tick only:
- [x] **Website content** (XDeck reads x.com posts shown in its columns to filter them, and stores
  posts the user explicitly saves; all locally).

Leave everything else unticked (personally identifiable information, health, financial, authentication,
personal communications, location, web history, user activity).

Tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL**

```
https://github.com/sergio-farfan/x-deck/blob/main/PRIVACY.md
```

## Store listing: URLs

- Homepage URL: `https://github.com/sergio-farfan/x-deck`
- Support URL: `https://github.com/sergio-farfan/x-deck/issues`

## Distribution tab

- Payments: free.
- Visibility: Public (or Unlisted to share by link only first).
- Regions: all regions.

## Test instructions tab

```
XDeck needs a logged-in X (x.com) account; without one the columns show X's sign-in page.

1. Sign in to x.com in a normal tab with a test account.
2. Click the XDeck toolbar icon (or open https://x.com/i/xdeck). The deck opens with two workspaces: "Main" (Home, Notifications, Mentions, Bookmarks) and "News" (two searches and two Explore columns, shown as a grid).
3. Try: Columns/Grid/Tabs in the top bar; the + button to add a column (e.g. Search); the sliders icon on a column header for filters; the bookmark-plus button in a post's action bar, then the bookmark icon in the left rail (Collections); the timer icon in the top bar for auto refresh.

About the header rule: while the deck tab is open, XDeck removes X-Frame-Options and CSP only from x.com pages framed by x.com in that tab (session rule with a tabIds condition), so X's own pages can appear as columns. Open any other x.com tab to confirm its headers are untouched.

XDeck sends no data anywhere; all storage is chrome.storage.local.
```
