# XDeck privacy policy

Last updated: 2026-10-23

XDeck is a Chrome extension that shows X (x.com) as a multi-column deck. This policy explains what
data XDeck handles and what it does with it.

## Summary

XDeck does not collect, transmit, sell or share any personal data. Everything it stores stays in your
own browser.

## What XDeck handles, and where it stays

- **Your deck setup:** workspaces, columns, filters and settings. Stored in your browser with the
  Chrome storage API (`chrome.storage.local`).
- **Posts you choose to save:** when you click XDeck's save button on a post, XDeck stores that
  post's text, author name and handle, link, time and counts (likes, reposts, replies), plus any tags
  and notes you add. Stored in `chrome.storage.local`.
- **Content of x.com pages shown in the deck:** XDeck reads the posts displayed in its columns,
  inside your browser, to apply your filters, hide items you chose to hide, count unread posts and
  show the alerts you turned on. This content is processed on the fly and is not stored, except for
  posts you explicitly save.

## What XDeck does not do

- It does not send any data to the developer or to any third party. XDeck has no server.
- It contains no analytics, tracking, advertising or telemetry.
- It does not read your X password, cookies or login tokens, and does not use X's API or any API
  keys. Columns are ordinary x.com pages that X shows using your existing login.
- It does not run on websites other than x.com, except for one right-click menu item
  ("Search X in XDeck") that receives only the text you select and click on.

## Chrome Web Store statistics

The Chrome Web Store, operated by Google, gives the developer aggregate statistics about XDeck's store
listing, such as listing page views and installs, including through Google Analytics. These
statistics come from the Chrome Web Store website and its install process, not from XDeck, and the
developer receives no data about individual users. Google's privacy policy covers that data. XDeck
itself collects nothing.

## Notifications

If you turn on desktop alerts for a column, XDeck shows a notification with the new post's author and
text. Notifications are generated locally by Chrome.

## Exports and imports

Exports (Markdown, CSV, JSON) are files that you choose to download to your own computer. Imports read
a JSON or CSV file that you choose, inside your browser, and add its saved posts to your local
collection; the file is not sent anywhere.

## Deleting your data

Delete saved posts from the Collections panel, reset settings in Settings > Reset to defaults, or
remove the extension from Chrome to delete everything XDeck stored.

## Relationship with X

XDeck is an independent, unofficial project and is not affiliated with, endorsed by or sponsored by
X Corp. Your use of x.com remains subject to X's own terms and privacy policy.

## Changes and contact

Changes to this policy will be published in this file in the project repository:
https://github.com/sergio-farfan/x-deck. Questions or requests:
https://github.com/sergio-farfan/x-deck/issues
