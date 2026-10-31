#!/usr/bin/env python3
# XDeck
# Create or update the dev.to article from dev-to-article.md.
# Author: Sergio Farfan
"""Publish dev-to-article.md to dev.to.

Usage:
    python3 scripts/update-devto-article.py                      # update the article body
    python3 scripts/update-devto-article.py --create [--publish]  # first publication

The API key is read from DEVTO_API_KEY or, when that is not set, from the macOS
Keychain item "devto-api-key". Store it once with:
    security add-generic-password -U -s devto-api-key -a "$USER" -w
(-w with no value prompts for the key, so it never appears in shell history).

--create posts a new article with the title, tags, description and cover image
below, as an unpublished draft unless --publish is given; then record its
article id in ARTICLE_ID (or pass DEVTO_ARTICLE_ID). Without --create the
script updates the existing article's body only, so the title, tags, cover
image and description set in the editor are preserved.

The leading HTML comment of dev-to-article.md (notes for the editor) is not
sent. The key comes from the environment or the Keychain only: never hardcode
it, paste it into a chat or commit it. Generate one at
https://dev.to/settings/extensions and revoke it there after use if in doubt.
dev.to sits behind Cloudflare, which rejects default Python user agents, hence
the browser-like User-Agent.
"""

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

ARTICLE_ID = 4950767  # Draft created 2026-10-30.
ARTICLE_SOURCE = os.path.join(os.path.dirname(__file__), "..", "dev-to-article.md")
TITLE = "XDeck: TweetDeck-style columns for X, free and open source"
TAGS = ["chrome", "javascript", "webdev", "opensource"]  # up to four; the API wants a list, a string is ignored
DESCRIPTION = (
    "A Chrome extension that turns X into live multi-column decks with filters, "
    "alerts and a reading pane, and what it took to frame x.com safely."
)
COVER_IMAGE = (
    "https://raw.githubusercontent.com/sergio-farfan/x-deck/"
    "c072c37a2bc31638ac0bf3776a52567b11f9d1b7/store/out/promo-marquee-1400x560.jpg"
)


def request(method, url, payload, api_key):
    req = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(payload).encode(),
        headers={
            "api-key": api_key,
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
    )
    try:
        with urllib.request.urlopen(req) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        sys.exit(f"HTTP {error.code}: {error.read().decode()[:500]}")


KEYCHAIN_SERVICE = "devto-api-key"
PLACEHOLDERS = {"xxxx", "your-key", "new_key", "new-key", "your-dev.to-key", "your-new-key"}


def api_key_from_environment_or_keychain():
    key = os.environ.get("DEVTO_API_KEY", "").strip()
    if key:
        if key.lower() in PLACEHOLDERS:
            sys.exit(f"DEVTO_API_KEY is the placeholder '{key}', not a real key. "
                     "Generate one at https://dev.to/settings/extensions.")
        return key
    if sys.platform == "darwin":
        result = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True, text=True, check=False)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()
    sys.exit("No dev.to API key. Set DEVTO_API_KEY or store it in the Keychain with:\n"
             f'  security add-generic-password -U -s {KEYCHAIN_SERVICE} -a "$USER" -w')


def article_body():
    with open(ARTICLE_SOURCE, encoding="utf-8") as source:
        body = source.read()
    return re.sub(r"\A\s*<!--.*?-->\s*", "", body, count=1, flags=re.S)


def main():
    api_key = api_key_from_environment_or_keychain()
    body = article_body()

    if "--create" in sys.argv[1:]:
        result = request(
            "POST",
            "https://dev.to/api/articles",
            {
                "article": {
                    "title": TITLE,
                    "body_markdown": body,
                    "published": "--publish" in sys.argv[1:],
                    "tags": TAGS,
                    "description": DESCRIPTION,
                    "main_image": COVER_IMAGE,
                }
            },
            api_key,
        )
        state = "Published" if result.get("published_at") else "Draft created"
        print(f"{state}: id {result['id']} {result.get('url', '')}")
        return

    article_id = os.environ.get("DEVTO_ARTICLE_ID") or ARTICLE_ID
    if not article_id:
        sys.exit("No article id. Use --create first, then set ARTICLE_ID or DEVTO_ARTICLE_ID.")
    result = request(
        "PUT",
        f"https://dev.to/api/articles/{article_id}",
        {"article": {"body_markdown": body}},
        api_key,
    )
    print(f"Updated: {result['url']} (edited {result.get('edited_at', 'n/a')})")


if __name__ == "__main__":
    main()
