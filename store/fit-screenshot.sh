#!/bin/zsh
# Turn any screenshot (e.g. Cmd+Shift+4 of the XDeck tab) into a Chrome Web
# Store screenshot: exactly 1280x800, JPEG, no alpha. The image is scaled to
# cover 1280x800 and the overflow is cropped evenly from the edges.
# Usage: store/fit-screenshot.sh ~/Desktop/Screenshot.png [store/out/screenshot-5-columns.jpg]
set -euo pipefail
in="$1"
out="${2:-store/out/screenshot-5-columns.jpg}"
[[ -f "$in" ]] || { print -u2 "No such file: $in"; exit 1; }
w=$(sips -g pixelWidth "$in" | awk '/pixelWidth/{print $2}')
h=$(sips -g pixelHeight "$in" | awk '/pixelHeight/{print $2}')
# scale factor that makes both sides at least 1280x800
read nw nh < <(python3 -c "import math; s=max(1280/$w, 800/$h); print(math.ceil($w*s), math.ceil($h*s))")
tmp="${out%.*}.tmp.png"
sips -s format png "$in" --out "$tmp" >/dev/null
sips -z "$nh" "$nw" "$tmp" >/dev/null
sips -c 800 1280 "$tmp" >/dev/null
sips -s format jpeg -s formatOptions 92 "$tmp" --out "$out" >/dev/null
rm -f "$tmp"
sips -g pixelWidth -g pixelHeight -g hasAlpha "$out" | tail -3
