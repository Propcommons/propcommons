# The main scene of the throwaway game project built by tools/smoke/godot_runtime.sh. It runs as a
# game (not in the editor), loads Prop Commons assets with tools/godot/prop_commons.gd, and either
# reports what it loaded or renders a composition.
#   check <glb>...                       -> prints RUNTIME_JSON with meshes, textures and sizes
#   render <composition.json> <library> <out.png>
# License: MIT (see LICENSE in the repository root).
extends Node3D

const PC = preload("res://prop_commons.gd")


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.is_empty():
		printerr("usage: check <glb>... | render <composition.json> <library> <out.png>")
		get_tree().quit(2)
	elif args[0] == "check":
		_check(args.slice(1))
	elif args[0] == "render":
		await _render(args[1], args[2], args[3])


func _relative_xform(node: Node, top: Node) -> Transform3D:
	var t := Transform3D.IDENTITY
	var n := node
	while n != null and n != top:
		if n is Node3D:
			t = (n as Node3D).transform * t
		n = n.get_parent()
	return t


## World-space bounds from the mesh's vertices. Transforming a mesh's own AABB would overstate a
## rotated object's size, so this measures what Three.js and Blender measure.
func _vertex_aabb(mi: MeshInstance3D, xform: Transform3D) -> AABB:
	var lo := Vector3(INF, INF, INF)
	var hi := Vector3(-INF, -INF, -INF)
	for s in mi.mesh.get_surface_count():
		var arrays := mi.mesh.surface_get_arrays(s)
		for v in arrays[Mesh.ARRAY_VERTEX]:
			var w: Vector3 = xform * v
			lo = lo.min(w)
			hi = hi.max(w)
	if lo.x == INF:
		return xform * mi.mesh.get_aabb()  # no vertex data (headless): fall back
	return AABB(lo, hi - lo)


func _report(scene: Node3D) -> Dictionary:
	var box := AABB()
	var first := true
	var meshes := 0
	var textures := []
	var untextured_materials := 0
	var missing_materials := 0
	for n in scene.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		meshes += 1
		var b := _relative_xform(mi, scene) * mi.mesh.get_aabb()
		box = b if first else box.merge(b)
		first = false
		for s in mi.mesh.get_surface_count():
			var mat := mi.mesh.surface_get_material(s) as BaseMaterial3D
			if mat == null:
				missing_materials += 1
			elif mat.albedo_texture:
				textures.append([mat.albedo_texture.get_width(), mat.albedo_texture.get_height()])
			else:
				untextured_materials += 1
	return {
		"mesh_instances": meshes,
		"importer_meshes": scene.find_children("*", "ImporterMeshInstance3D", true, false).size(),
		"textures": textures,
		"untextured_materials": untextured_materials,
		"missing_materials": missing_materials,
		"size": [box.size.x, box.size.y, box.size.z],
		"editor_hint": Engine.is_editor_hint(),
	}


func _check(files: Array) -> void:
	var out := []
	for f in files:
		var scene := PC.load_asset_file(f)
		if scene == null:
			get_tree().quit(1)
			return
		out.append(_report(scene))
		scene.free()
	print("RUNTIME_JSON " + JSON.stringify(out))
	get_tree().quit(0)


func _render(composition_path: String, library: String, png: String) -> void:
	var scene := PC.load_composition_file(composition_path, library)
	add_child(scene)

	var sky := Sky.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color(0.75, 0.78, 0.82)
	sky_material.sky_horizon_color = Color(0.9, 0.9, 0.89)
	sky_material.ground_horizon_color = Color(0.9, 0.9, 0.89)
	sky_material.ground_bottom_color = Color(0.45, 0.44, 0.42)
	sky.sky_material = sky_material
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.light_energy = 1.4
	add_child(sun)
	sun.look_at_from_position(Vector3(-0.6, 0.75, 0.7), Vector3.ZERO)

	var items := []
	var all := AABB()
	for i in scene.get_child_count():
		var item := scene.get_child(i) as Node3D
		var r := _report(item)
		var b := AABB()
		var first := true
		for n in item.find_children("*", "MeshInstance3D", true, false):
			var mi := n as MeshInstance3D
			var bb := _vertex_aabb(mi, _relative_xform(mi, self))
			b = bb if first else b.merge(bb)
			first = false
		all = b if i == 0 else all.merge(b)
		items.append({"asset": str(item.name), "min": [b.position.x, b.position.y, b.position.z], "max": [b.end.x, b.end.y, b.end.z], "textures": r["textures"].size()})

	var cam := Camera3D.new()
	cam.fov = 30
	add_child(cam)
	var dir := Vector3(sin(deg_to_rad(35)) * cos(deg_to_rad(22)), sin(deg_to_rad(22)), cos(deg_to_rad(35)) * cos(deg_to_rad(22)))
	var centre := all.get_center()
	cam.look_at_from_position(centre + dir * (all.size.length() / 2) * 1.15 / sin(deg_to_rad(15)), centre)
	cam.make_current()
	for _i in 10:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(png)
	print("RENDER_JSON " + JSON.stringify({"items": items, "editor_hint": Engine.is_editor_hint()}))
	get_tree().quit(0)
