#!/bin/zsh
set -euo pipefail
EXT_DIR="$HOME/Projects/chatgpt-multi-pane-extension"
PROFILE="$HOME/Library/Application Support/Google/Chrome Default"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
exec "$CHROME" "chrome://extensions"
cat <<EOF
Load unpacked: $EXT_DIR
Then click extension icon; it opens app.html full-page.
EOF
