#!/usr/bin/env sh
# Double-click (macOS: right-click > Open) or run ./start-mac-linux.sh
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Get it from https://nodejs.org (version 20 or newer)."; exit 1; }
[ -d node_modules ] || { echo "Installing Stickframe for the first time..."; npm install --no-fund --no-audit || exit 1; }
exec node server/index.js
