# Loads a composition into a Godot project exactly as a game would (assets imported by Godot's own
# importer), renders one frame, saves it as a PNG, and prints each placed item's world-space bounds
# as JSON. A manual check that Prop Commons assets work in Godot with their materials and textures.
# Run it with tools/smoke/godot_composition.sh, which builds a throwaway project from copies.
# Needs a real window (it renders), so it is not run in CI.
# License: MIT (see LICENSE in the repository root).
extends SceneTree


func _load_asset(ref: String) -> Node3D:
	# author/slug@N -> res://assets/author/slug/vN/model.glb, imported by Godot's own importer,
	# exactly as when a developer drops the file into their project.
	var at := ref.split("@")
	var path := "res://assets/%s/v%s/model.glb" % [at[0], at[1]]
	var scene := load(path) as PackedScene
	if scene == null:
		push_error("could not load %s" % path)
		return null
	return scene.instantiate() as Node3D


func _aabb(node: Node) -> AABB:
	var box := AABB()
	var first := true
	var meshes := node.find_children("*", "MeshInstance3D", true, false)
	if node is MeshInstance3D:
		meshes.append(node)
	if meshes.is_empty():
		printerr("no MeshInstance3D under %s (%s); child: %s" % [node.name, node.get_class(), node.get_child(0).get_class() if node.get_child_count() else "none"])
	for n in meshes:
		var mi := n as MeshInstance3D
		var b := mi.global_transform * mi.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	var composition: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(args[0]))
	var out: String = args[1]

	var world := Node3D.new()
	root.add_child(world)

	var env := Environment.new()
	# A neutral procedural sky, so metals and glossy surfaces have something to reflect.
	var sky := Sky.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color(0.75, 0.78, 0.82)
	sky_material.sky_horizon_color = Color(0.9, 0.9, 0.89)
	sky_material.ground_horizon_color = Color(0.9, 0.9, 0.89)
	sky_material.ground_bottom_color = Color(0.45, 0.44, 0.42)
	sky.sky_material = sky_material
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	var we := WorldEnvironment.new()
	we.environment = env
	world.add_child(we)

	var sun := DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.light_energy = 1.4
	world.add_child(sun)
	sun.look_at_from_position(Vector3(-0.6, 0.75, 0.7), Vector3.ZERO)

	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(4, 4)
	ground.mesh = plane
	world.add_child(ground)

	var cache := {}
	var placed := []
	for item in composition["items"]:
		var ref: String = item["asset"]
		if not cache.has(ref):
			cache[ref] = _load_asset(ref)
		var node: Node3D = (cache[ref] as Node3D).duplicate()
		var p: Array = item["position"]
		var r: Array = item["rotation"]
		var s: float = item.get("scale", 1.0)
		node.transform = Transform3D(Basis(Quaternion(r[0], r[1], r[2], r[3])).scaled(Vector3(s, s, s)), Vector3(p[0], p[1], p[2]))
		world.add_child(node)
		placed.append([ref, node])

	# Let the nodes enter the scene tree before measuring.
	await process_frame
	var all := AABB()
	var bounds := []
	for i in placed.size():
		var b := _aabb(placed[i][1])
		all = b if i == 0 else all.merge(b)
		bounds.append({"asset": placed[i][0], "min": [b.position.x, b.position.y, b.position.z], "max": [b.end.x, b.end.y, b.end.z]})

	# Three-quarter front view, framed to the scene.
	var cam := Camera3D.new()
	cam.fov = 30
	world.add_child(cam)
	var centre := all.get_center()
	var radius := all.size.length() / 2
	var dir := Vector3(sin(deg_to_rad(35)) * cos(deg_to_rad(22)), sin(deg_to_rad(22)), cos(deg_to_rad(35)) * cos(deg_to_rad(22)))
	cam.look_at_from_position(centre + dir * radius * 1.15 / sin(deg_to_rad(15)), centre)
	cam.make_current()

	for _i in 10:
		await process_frame
	await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png(out)
	print("BOUNDS_JSON " + JSON.stringify(bounds))
	world.queue_free()
	for value in cache.values():
		(value as Node).free()
	await process_frame
	quit(0)
