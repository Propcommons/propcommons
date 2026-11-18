#!/usr/bin/env bash
# Imports .glb files in a throwaway Godot project with the Prop Commons editor plugin enabled, the
# way the editor does when a user drops them in, and reports each imported material as JSON.
#   tools/smoke/godot_editor_import.sh <glb>...        (headless)
# Prints IMPORT_JSON [[{name, transparency, alpha}, ...], ...], one list per file.
# Files are copied into the project, never changed in place. GODOT can point at the Godot binary.
# License: MIT (see LICENSE in the repository root).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
GODOT="${GODOT:-$HOME/Applications/Godot.app/Contents/MacOS/Godot}"
PROJ="$(mktemp -d)"
trap 'rm -rf "$PROJ"' EXIT
cat > "$PROJ/project.godot" <<'P'
config_version=5

[application]

config/name="Prop Commons import test"

[editor_plugins]

enabled=PackedStringArray("res://addons/prop_commons/plugin.cfg")
P
mkdir -p "$PROJ/addons" "$PROJ/models"
cp -R "$REPO/tools/godot/addons/prop_commons" "$PROJ/addons/prop_commons"
n=0
for f in "$@"; do
  cp "$f" "$PROJ/models/$n.glb"
  n=$((n + 1))
done
cat > "$PROJ/report.gd" <<'P'
extends SceneTree
func _initialize() -> void:
	var out := []
	var i := 0
	while ResourceLoader.exists("res://models/%d.glb" % i):
		var scene: Node = (load("res://models/%d.glb" % i) as PackedScene).instantiate()
		var mats := []
		for mi in scene.find_children("*", "MeshInstance3D", true, false):
			var mesh: Mesh = (mi as MeshInstance3D).mesh
			for s in mesh.get_surface_count():
				var m := mesh.surface_get_material(s) as BaseMaterial3D
				if m:
					mats.append({"name": m.resource_name, "transparency": m.transparency, "alpha": m.albedo_color.a})
		out.append(mats)
		scene.free()
		i += 1
	print("IMPORT_JSON " + JSON.stringify(out))
	quit()
P
# The first run imports everything (and registers the plugin); the second reports.
"$GODOT" --headless --path "$PROJ" --import >/dev/null 2>&1 || true
"$GODOT" --headless --path "$PROJ" --script res://report.gd 2>&1
