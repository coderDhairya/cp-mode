#!/bin/bash
# Double-click to launch CP // MODE as a desktop app (first run installs it).
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
npm start
