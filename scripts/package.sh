#!/usr/bin/env bash
# Builds dist/<name>-<version>.zip with only the files the extension needs (manifest.json at the zip root).
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
out="dist/filmaffinity-extendido-$version.zip"
npm run --silent build:css
mkdir -p dist
rm -f "$out"
zip -r -q "$out" manifest.json icons src -x "src/popup/input.css"
echo "Created $out"
unzip -l "$out"
