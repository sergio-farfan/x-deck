# Chrome Web Store: Privacy, Distribution and Test instructions tabs

Store listing text and images: see `store/LISTING.md` and `store/out/`.
Package to upload: `xdeck.zip`, version 0.1.2 (build with `npm run zip`; the same files are in the
GitHub release https://github.com/sergio-farfan/x-deck/releases/tag/v0.1.2).

Version 0.1.2 requests: storage, notifications, contextMenus, declarativeNetRequestWithHostAccess, and
host access to https://x.com/* only. If the dashboard shows any other permission (unlimitedStorage,
twitter.com), an older package is still uploaded: upload the current zip on the Package tab.

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

notifications:
```
Shows an optional desktop alert when a new post appears in a column for which the user turned alerts on. Off by default; enabled per column by the user.
```

contextMenus:
```
Adds right-click items: "Add this page as an XDeck column" on x.com pages, "Add link as an XDeck column" on x.com and twitter.com links, and "Search X in XDeck" for selected text, which opens a search column for that text. The menus only pass the clicked URL or selected text to the deck; no page content is read.
```

declarativeNetRequestWithHostAccess:
```
X sends X-Frame-Options: DENY and a CSP frame-ancestors rule, which stop its pages from appearing as deck columns. While the user's deck tab (https://x.com/i/xdeck) is open, XDeck adds a session rule that removes those two response headers only for x.com pages loaded as frames by x.com, and only in that one tab (tabIds condition). The rule is removed when the tab closes or navigates away. Normal x.com tabs and all other sites keep their headers.
```

Host permission (https://x.com/*):
```
Runs the deck at https://x.com/i/xdeck and a content script in x.com pages shown as its columns, to apply the user's filters and clean-up options, count unread posts and add the save button. In normal x.com tabs the content script does nothing unless the user turns on the optional "apply Clean X to normal x.com tabs" setting. Also required for the header rule above. XDeck requests no other host access.
```

**Are you using remote code?** No, I am not using remote code.
(All JavaScript is in the package; the deck's modules are loaded from the extension itself.)

**Data usage**

Tick only:
- [x] **Website content** (XDeck reads x.com posts shown in its columns to filter them, and stores
  posts the user explicitly saves; all locally).

Leave everything else unticked (personally identifiable information, health, financial, authentication,
personal communications, location, web history, user activity). XDeck notices hovering and scrolling
inside its own columns only to pause auto refresh and mark posts read; it does not record or store that
activity, and nothing leaves the browser.

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

The field is limited to 500 characters (this text is 469). Put the X test account's username and
password in the separate credential fields on the same tab.

```
Needs a logged-in X account: sign in at x.com first (test login in the fields above).
1. Click the XDeck icon or open https://x.com/i/xdeck. Workspaces Main and News load.
2. Try Columns/Grid/Tabs, + (add column), a column's sliders (filters), the save button on a post, the timer icon, and ? for shortcuts.
Header rule: only in the deck tab, XDeck removes X-Frame-Options/CSP from x.com frames so columns can load; other tabs are untouched. No data leaves the browser.
```
