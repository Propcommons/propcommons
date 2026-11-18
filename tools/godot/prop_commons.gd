# Prop Commons runtime loader for Godot 4.
#
# Loads Prop Commons assets (plain .glb files) and compositions while a game is running, with
# their materials and textures, as ready-to-render nodes. Copy this file into your project; it
# needs nothing else. Tested with Godot 4.7.2.
#
#   var mug := PropCommons.load_asset_file("user://library/assets/alice/mug/v1/model.glb")
#   add_child(mug)
#
#   # From bytes you downloaded yourself, e.g. with HTTPRequest from the site:
#   var apple := PropCommons.load_asset_buffer(body)
#
#   # A whole composition, from a local copy of the library (the repository layout):
#   var scene := PropCommons.load_composition_file(
#       "user://library/compositions/alice/fruit-bowl/v1/composition.json", "user://library")
#
# Assets are in metres, +Y up, front facing +Z, resting on y = 0, like Godot itself, so a loaded
# asset needs no conversion. Errors are reported with push_error() and the functions return null.
#
# License: MIT (see LICENSE in the Prop Commons repository).
class_name PropCommons
extends RefCounted


## Loads one asset's model.glb from a file path (res://, user:// or an absolute path).
static func load_asset_file(path: String) -> Node3D:
	var bytes := FileAccess.get_file_as_bytes(path)
	if bytes.is_empty():
		push_error("PropCommons: could not read %s (%s)" % [path, error_string(FileAccess.get_open_error())])
		return null
	return load_asset_buffer(bytes, path.get_file().get_basename())


## Loads one asset from the bytes of a .glb file.
static func load_asset_buffer(bytes: PackedByteArray, name := "") -> Node3D:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	# Keep textures in memory. The default asks the editor to extract and import them as files,
	# which a running game can't do.
	state.handle_binary_image = GLTFState.HANDLE_BINARY_EMBED_AS_UNCOMPRESSED
	var err := doc.append_from_buffer(bytes, "", state)
	if err != OK:
		push_error("PropCommons: not a readable glTF binary (%s)" % error_string(err))
		return null
	var scene := doc.generate_scene(state) as Node3D
	if scene == null:
		push_error("PropCommons: the glTF file has no scene")
		return null
	_finish_meshes(scene)
	if name != "":
		scene.name = name
	return scene


## Loads a composition: every pinned asset placed at its position, rotation and scale.
## library_root is the folder that holds assets/ (a copy of the repository or the site).
static func load_composition_file(composition_path: String, library_root: String) -> Node3D:
	var text := FileAccess.get_file_as_string(composition_path)
	var data = JSON.parse_string(text)
	if typeof(data) != TYPE_DICTIONARY or not data.has("items"):
		push_error("PropCommons: %s is not a composition" % composition_path)
		return null
	var root := Node3D.new()
	root.name = str(data.get("name", "Composition"))
	var cache := {}
	var index := 0
	for item in data["items"]:
		index += 1
		var ref := str(item.get("asset", ""))
		if not cache.has(ref):
			cache[ref] = load_asset_file(asset_path(library_root, ref))
		var source: Node3D = cache[ref]
		if source == null:
			continue  # reported already; a taken-down asset is simply left out
		var node := source.duplicate() as Node3D
		node.transform = placement(item)
		# Node names can't contain "/" or "@": alice/mug@3 becomes "03 alice_mug_v3".
		node.name = "%02d %s" % [index, ref.replace("/", "_").replace("@", "_v")]
		root.add_child(node)
	for source in cache.values():
		if source != null:
			(source as Node).free()
	return root


## The model path for a pinned ID: alice/mug@3 -> <library_root>/assets/alice/mug/v3/model.glb
static func asset_path(library_root: String, ref: String) -> String:
	var parts := ref.split("@")
	if parts.size() != 2:
		return ""
	return library_root.path_join("assets/%s/v%s/model.glb" % [parts[0], parts[1]])


## A composition item's transform: position in metres, rotation as a glTF quaternion
## [x, y, z, w], and an optional uniform scale (default 1).
static func placement(item: Dictionary) -> Transform3D:
	var p: Array = item.get("position", [0, 0, 0])
	var r: Array = item.get("rotation", [0, 0, 0, 1])
	var s := float(item.get("scale", 1.0))
	var basis := Basis(Quaternion(r[0], r[1], r[2], r[3]).normalized()).scaled(Vector3(s, s, s))
	return Transform3D(basis, Vector3(p[0], p[1], p[2]))


## When GLTFDocument runs inside the editor (tool scripts, editor plugins, `godot --script`), it
## returns ImporterMeshInstance3D nodes meant for the import pipeline. Swap them for ordinary
## MeshInstance3D nodes so the result renders anywhere. In a running game this finds nothing to do.
static func _finish_meshes(node: Node) -> void:
	for child in node.get_children():
		_finish_meshes(child)
	if node is ImporterMeshInstance3D:
		var importer := node as ImporterMeshInstance3D
		var mesh_instance := MeshInstance3D.new()
		mesh_instance.name = importer.name
		mesh_instance.transform = importer.transform
		if importer.mesh:
			mesh_instance.mesh = importer.mesh.get_mesh()
		mesh_instance.skin = importer.skin
		var parent := importer.get_parent()
		var index := importer.get_index()
		for child in importer.get_children():
			importer.remove_child(child)
			mesh_instance.add_child(child)
		parent.remove_child(importer)
		parent.add_child(mesh_instance)
		parent.move_child(mesh_instance, index)
		importer.free()
