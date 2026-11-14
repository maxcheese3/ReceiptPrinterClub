#!/bin/sh
# Renders icons/app-icon.svg to the home-screen icons in public/.
# macOS: uses Google Chrome to rasterise (set CHROME=/path/to/chrome if it isn't
# in the default location) and sips to downscale. Re-run after changing the SVG
# and commit the PNGs.
set -e
cd "$(dirname "$0")/.."

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

# Headless Chrome won't make a window smaller than ~500px, so render the largest
# size and scale down from it.
"$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --default-background-color=000000ff --window-size=512,512 \
  --screenshot="$PWD/public/icon-512.png" "file://$PWD/icons/app-icon.svg" >/dev/null 2>&1
echo "public/icon-512.png (512x512)"

for spec in 180:apple-touch-icon.png 192:icon-192.png; do
  size=${spec%%:*}; name=${spec#*:}
  sips -z "$size" "$size" public/icon-512.png --out "public/$name" >/dev/null
  echo "public/$name (${size}x${size})"
done
