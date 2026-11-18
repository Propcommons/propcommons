#!/usr/bin/env bash
# Builds a throwaway Godot game project around tools/godot/prop_commons.gd and runs it as a game
# (not in the editor), to check that Prop Commons assets load at runtime.
#   tools/smoke/godot_runtime.sh check <glb>...                      (headless, as a game)
#   tools/smoke/godot_runtime.sh check-editor <glb>...               (headless, editor mode)
#   tools/smoke/godot_runtime.sh render <composition folder> <out.png> [library root]  (opens a window briefly)
# Files are passed by absolute path and only read. GODOT can point at the Godot binary.
# License: MIT (see LICENSE in the repository root).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-$HOME/Applications/Godot.app/Contents/MacOS/Godot}"
PROJ="$(mktemp -d)"
trap 'rm -rf "$PROJ"' EXIT
cat > "$PROJ/project.godot" <<'P'
config_version=5

[application]

config/name="Prop Commons runtime test"
run/main_scene="res://main.tscn"
P
cat > "$PROJ/main.tscn" <<'P'
[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://main.gd" id="1"]

[node name="Main" type="Node3D"]
script = ExtResource("1")
P
cp "$REPO/tools/godot/prop_commons.gd" "$PROJ/prop_commons.gd"
cp "$REPO/tools/smoke/godot_runtime_main.gd" "$PROJ/main.gd"
cat > "$PROJ/editor_check.gd" <<'P'
extends SceneTree
const PC = preload("res://prop_commons.gd")
func _initialize() -> void:
	var reporter = preload("res://main.gd").new()
	var out := []
	for f in OS.get_cmdline_user_args():
		var scene := PC.load_asset_file(f)
		out.append(reporter._report(scene))
		scene.free()
	reporter.free()
	print("RUNTIME_JSON " + JSON.stringify(out))
	quit(0)
P
"$GODOT" --headless --path "$PROJ" --import >/dev/null 2>&1 || true

abs() { (cd "$(dirname "$1")" && echo "$(pwd)/$(basename "$1")"); }
case "${1:-}" in
  check)
    shift
    files=()
    for f in "$@"; do files+=("$(abs "$f")"); done
    "$GODOT" --headless --path "$PROJ" -- check "${files[@]}"
    ;;
  check-editor)
    # The same check from editor mode (godot --script), where GLTFDocument returns importer meshes
    # that the loader must convert.
    shift
    files=()
    for f in "$@"; do files+=("$(abs "$f")"); done
    # Outside any project, `godot --script` runs with the editor hint set.
    BARE="$PROJ/bare" && mkdir "$BARE"
    cp "$PROJ/prop_commons.gd" "$PROJ/main.gd" "$PROJ/editor_check.gd" "$BARE/"
    (cd "$BARE" && "$GODOT" --headless --script "$BARE/editor_check.gd" -- "${files[@]}")
    ;;
  render)
    comp="$(abs "$2")/composition.json"
    library="${4:-$REPO}"
    "$GODOT" --path "$PROJ" --resolution 1280x800 -- render "$comp" "$(cd "$library" && pwd)" "$(abs "$3")"
    ;;
  *)
    echo "usage: $0 check|check-editor <glb>... | render <composition folder> <out.png>" >&2
    exit 2
    ;;
esac
