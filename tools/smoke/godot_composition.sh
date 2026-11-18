#!/usr/bin/env bash
# Renders a composition in Godot, the way a game developer would use the assets: copies assets/
# and the composition into a throwaway Godot project, lets Godot's importer import them, then
# loads and renders the composition. The repository itself is never touched.
#   tools/smoke/godot_composition.sh compositions/mattashes/fruit-bowl/v1 out.png
# GODOT can point at the Godot binary. Opens a window briefly. License: MIT.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-$HOME/Applications/Godot.app/Contents/MacOS/Godot}"
COMP="$1"
OUT="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
PROJ="$(mktemp -d)"
trap 'rm -rf "$PROJ"' EXIT
printf 'config_version=5\n\n[application]\n\nconfig/name="Prop Commons smoke test"\n' > "$PROJ/project.godot"
cp -R "$REPO/assets" "$PROJ/assets"
mkdir -p "$PROJ/$(dirname "$COMP")" && cp -R "$REPO/$COMP" "$PROJ/$COMP"
cp "$REPO/tools/smoke/godot_composition.gd" "$PROJ/render.gd"
"$GODOT" --headless --path "$PROJ" --import >/dev/null 2>&1 || true
"$GODOT" --path "$PROJ" --resolution 1280x800 --script res://render.gd -- "$COMP/composition.json" "$OUT"
