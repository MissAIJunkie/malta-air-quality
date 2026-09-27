#!/usr/bin/env bash
# Fetch the three faces the app itself loads (src/app/layout.tsx), unsubsetted.
#
# The legacy user agent matters: the modern css2 response is split by
# unicode-range into disjoint subsets, and registering only `latin` drops the
# Maltese ħ ġ ż ċ mid-word while registering only `latin-ext` drops ASCII.
# A legacy UA returns one unsubsetted TrueType file per weight.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fonts && cd fonts
for q in "Space+Grotesk:wght@500;600;700" "Public+Sans:wght@400;600" "IBM+Plex+Mono:wght@400;500;600"; do
  curl -fsS -A "Mozilla/4.0" "https://fonts.googleapis.com/css2?family=$q&display=swap"
done > legacy.css
grep -c unicode-range legacy.css >/dev/null && { echo "unexpected unicode-range in response" >&2; exit 1; } || true
python3 - <<'PY'
import re, urllib.request
css = open('legacy.css').read()
for b in re.findall(r'@font-face\s*\{(.*?)\}', css, re.S):
    fam = re.search(r"font-family:\s*'([^']+)'", b).group(1).replace(' ', '')
    w   = re.search(r'font-weight:\s*(\d+)', b).group(1)
    url = re.search(r'url\(([^)]+)\)', b).group(1)
    name = f'{fam}-{w}.ttf'
    urllib.request.urlretrieve(url, name)
    print(name)
PY
