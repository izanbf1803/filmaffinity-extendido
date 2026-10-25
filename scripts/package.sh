#!/usr/bin/env bash
# Builds dist/filmaffinity-extendido-<version>.zip with only the files the extension needs
# (manifest.json at the zip root).
#
#   npm run package               rebuild the zip with the current version
#   npm run package -- patch      bump the version first (patch | minor | major), then rebuild
#
# The Chrome Web Store requires a higher version for every upload, so bump before a new release.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ $# -gt 0 ]; then
  node -e '
    const fs = require("fs");
    const m = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
    const [maj, min, pat] = m.version.split(".").map(Number);
    const next = { major: [maj + 1, 0, 0], minor: [maj, min + 1, 0], patch: [maj, min, pat + 1] }[process.argv[1]];
    if (!next) { console.error("Usage: package.sh [patch|minor|major]"); process.exit(1); }
    m.version = next.join(".");
    fs.writeFileSync("manifest.json", JSON.stringify(m, null, 2) + "\n");
    console.log("Version bumped to " + m.version);
  ' "$1"
fi

version=$(node -p "require('./manifest.json').version")
out="dist/filmaffinity-extendido-$version.zip"
npm run --silent build:css
mkdir -p dist
rm -f "$out"
zip -r -q "$out" manifest.json icons src -x "src/popup/input.css"
echo "Created $out"
