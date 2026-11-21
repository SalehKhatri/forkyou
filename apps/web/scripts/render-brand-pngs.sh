#!/usr/bin/env bash
# Renders the PNG versions of the brand artwork from the SVGs in apps/web/public/brand, for the
# places that don't take SVG: the VS Code Marketplace icon, the Apple touch icon and the social
# preview image. See docs/brand.md. Needs Google Chrome or Chromium; set CHROME to its path if it
# isn't found. The social image loads its fonts from Google Fonts, so it needs a network connection.
#
#   bash apps/web/scripts/render-brand-pngs.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
brand="$root/apps/web/public/brand"

chrome="${CHROME:-}"
if [[ -z "$chrome" ]]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$(command -v google-chrome || true)" \
    "$(command -v chromium || true)" \
    "$(command -v chromium-browser || true)"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then chrome="$candidate"; break; fi
  done
fi
if [[ -z "$chrome" ]]; then
  echo "Chrome or Chromium not found. Set CHROME=/path/to/chrome." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

render() { # <html file> <width> <height> <output> [extra chrome flags...]
  local html="$1" width="$2" height="$3" out="$4"
  shift 4
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --window-size="$width,$height" --screenshot="$out" "$@" "file://$html" 2>/dev/null
  echo "wrote ${out#"$root"/}"
}

cat >"$work/icon.html" <<HTML
<!doctype html><html><body style="margin:0;background:transparent">
<img src="file://$brand/logo.svg" style="display:block;width:256px;height:256px">
</body></html>
HTML

cat >"$work/apple.html" <<HTML
<!doctype html><html><body style="margin:0;width:180px;height:180px;background:#0c1116;display:flex;align-items:center;justify-content:center">
<img src="file://$brand/logo.svg" style="width:146px;height:146px">
</body></html>
HTML

cat >"$work/og.html" <<HTML
<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,800&family=Instrument+Serif:ital@1&family=Geist:wght@400;500&display=block" rel="stylesheet">
</head><body style="margin:0;width:1200px;height:630px;box-sizing:border-box;padding:0 96px;display:flex;align-items:center;gap:64px;background-color:#0a0e12;background-image:radial-gradient(rgba(148,163,184,.10) 1px,transparent 1.4px);background-size:7px 7px;color:#e8eef2;font-family:Geist,sans-serif">
<img src="file://$brand/logo.svg" style="width:300px;height:300px;transform:rotate(-5deg);filter:drop-shadow(0 18px 30px rgba(0,0,0,.45))">
<div style="display:flex;flex-direction:column;gap:22px">
  <div style="font-family:'Bricolage Grotesque';font-weight:800;font-size:120px;letter-spacing:-.045em;line-height:.9">fork<span style="font-family:'Instrument Serif';font-style:italic;font-weight:400;letter-spacing:-.01em;color:#22d3ee;font-size:132px">you</span></div>
  <div style="font-size:34px;line-height:1.3;color:#c3ccd3;max-width:620px">Every minute in the editor counts.</div>
  <div style="font-size:24px;color:#92a1ad">Coding time, streaks and a weekly leaderboard · free and open source</div>
</div>
</body></html>
HTML

render "$work/icon.html" 256 256 "$root/extensions/vscode/media/icon.png" --default-background-color=00000000
render "$work/apple.html" 180 180 "$root/apps/web/src/app/apple-icon.png"
render "$work/og.html" 1200 630 "$root/apps/web/src/app/opengraph-image.png" --virtual-time-budget=5000
