# Prop Commons editor plugin: registers the glass import extension while the plugin is enabled.
# Copy the addons/prop_commons folder into your project and enable it in Project Settings >
# Plugins, then reimport any .glb that uses glass. Tested with Godot 4.7.2.
#
# License: MIT (see LICENSE in the Prop Commons repository).
@tool
extends EditorPlugin

var _glass: GLTFDocumentExtension


func _enter_tree() -> void:
	_glass = preload("glass_extension.gd").new()
	GLTFDocument.register_gltf_document_extension(_glass)


func _exit_tree() -> void:
	GLTFDocument.unregister_gltf_document_extension(_glass)
	_glass = null
