# Prop Commons glass import extension for Godot 4.
#
# Godot's glTF importer ignores KHR_materials_transmission, so clear glass imports as an opaque,
# pale material. This approximates it with alpha blending (the see-through part faded out) and a
# light version of the glass tint from KHR_materials_volume. The editor plugin in this folder
# registers it for every import; at runtime, prop_commons.gd does the same.
#
# The function below is the same as _approximate_glass in tools/godot/prop_commons.gd, and a test
# keeps the two identical.
#
# License: MIT (see LICENSE in the Prop Commons repository).
@tool
extends GLTFDocumentExtension


func _import_post_parse(state: GLTFState) -> Error:
	_approximate_glass(state)
	return OK


static func _approximate_glass(state: GLTFState) -> void:
	var json := state.json
	if typeof(json) != TYPE_DICTIONARY or not json.has("materials"):
		return
	var materials := state.get_materials()
	var specs: Array = json["materials"]
	for i in mini(specs.size(), materials.size()):
		var spec = specs[i]
		if typeof(spec) != TYPE_DICTIONARY or not spec.has("extensions"):
			continue
		var ext = spec["extensions"]
		if typeof(ext) != TYPE_DICTIONARY or not ext.has("KHR_materials_transmission"):
			continue
		var transmission := clampf(float(ext["KHR_materials_transmission"].get("transmissionFactor", 0.0)), 0.0, 1.0)
		var material := materials[i] as BaseMaterial3D
		if transmission <= 0.0 or material == null:
			continue
		var colour := material.albedo_color
		var volume = ext.get("KHR_materials_volume", {})
		if typeof(volume) == TYPE_DICTIONARY and volume.has("attenuationColor"):
			var tint: Array = volume["attenuationColor"]
			# The tint is what a thick piece absorbs; thin walls show only a little of it.
			colour = colour * Color(1, 1, 1).lerp(Color(float(tint[0]), float(tint[1]), float(tint[2])), 0.25)
		colour.a *= lerpf(1.0, 0.12, transmission)
		material.albedo_color = colour
		material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		material.cull_mode = BaseMaterial3D.CULL_DISABLED
		material.metallic_specular = 0.6
