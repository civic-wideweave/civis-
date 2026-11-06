#!/usr/bin/env bash
set -euo pipefail
OUT_DIR="$(cd "$1" && pwd)"
ROOT="$(cd "$(dirname "$1")" && pwd)"
SCRIPTS_DIR="$ROOT/scripts"

# Patch bare relative imports in the compiled helpers so dynamic import/require can resolve them.
for f in "$OUT_DIR/lib"/*.js; do
  [ -f "$f" ] || continue
  perl -pi -e 's/from\s+"(?:\.\/)?([a-zA-Z_][a-zA-Z0-9_]*)"\s*;?$/from "./$1.js";/g' "$f"
  perl -pi -e 's/require\(\s*"(?:\.\/)?([a-zA-Z_][a-zA-Z0-9_]*)"\s*\)/require("./$1.js")/g' "$f"
done
echo "patched $OUT_DIR/lib/*.js bare imports"

# Copy patched helpers into scripts/ so gen-seed-db.mjs can import them as .mjs.
for f in "$OUT_DIR/lib"/*.js; do
  [ -f "$f" ] || continue
  base=$(basename "$f" .js)
  dst="$SCRIPTS_DIR/$base.mjs"
  cp "$f" "$dst"
  echo "copied $dst"
done
