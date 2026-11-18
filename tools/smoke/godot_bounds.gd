# Loads glTF files with Godot's own glTF importer (GLTFDocument) and prints each one's size as JSON.
#   godot --headless --script tools/smoke/godot_bounds.gd -- a.glb b.glb
# Godot is +Y up like glTF, so sizes compare directly. Output: one line starting with BOUNDS_JSON.
#
# Headless Godot has no real renderer, which keeps no mesh data and can crash on textures, so this
# reads the imported geometry from the importer's state (ImporterMesh, held in memory) and skips
# textures, which a size check does not need.
# License: MIT (see LICENSE in the repository root).
extends SceneTree


func _world(state: GLTFState, index: int) -> Transform3D:
	var nodes := state.get_nodes()
	var node: GLTFNode = nodes[index]
	var t: Transform3D = node.xform
	var parent := node.parent
	while parent >= 0:
		var p: GLTFNode = nodes[parent]
		t = p.xform * t
		parent = p.parent
	return t


func _initialize() -> void:
	var sizes := []
	for f in OS.get_cmdline_user_args():
		var doc := GLTFDocument.new()
		var state := GLTFState.new()
		state.handle_binary_image = GLTFState.HANDLE_BINARY_DISCARD_TEXTURES
		var err := doc.append_from_file(f, state)
		if err != OK:
			printerr("could not load %s: %s" % [f, err])
			quit(1)
			return
		var lo := Vector3(INF, INF, INF)
		var hi := Vector3(-INF, -INF, -INF)
		var meshes := state.get_meshes()
		var nodes := state.get_nodes()
		for i in nodes.size():
			var node: GLTFNode = nodes[i]
			if node.mesh < 0:
				continue
			var t := _world(state, i)
			var mesh: ImporterMesh = (meshes[node.mesh] as GLTFMesh).mesh
			for s in mesh.get_surface_count():
				var arrays := mesh.get_surface_arrays(s)
				for v in arrays[Mesh.ARRAY_VERTEX]:
					var w: Vector3 = t * v
					lo = lo.min(w)
					hi = hi.max(w)
		var d := hi - lo
		sizes.append([snappedf(d.x, 0.000001), snappedf(d.y, 0.000001), snappedf(d.z, 0.000001)])
	print("BOUNDS_JSON " + JSON.stringify(sizes))
	quit(0)
