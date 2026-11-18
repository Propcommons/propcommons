"""Loads a Prop Commons composition into Blender, as a Blender user would: each pinned asset's
model.glb imported with Blender's glTF importer and placed at its position, rotation and scale.
Prints each item's world-space bounds (in glTF axes, metres) as JSON, and renders a picture.

    blender --background --factory-startup --python tools/smoke/blender_composition.py -- \
        <library root> <composition.json> <out.png>

Blender is Z-up; the importer converts from glTF's +Y up. Placements are given in glTF axes, so
each one is converted the same way: glTF (x, y, z) is Blender (x, -z, y). Bounds are printed back
in glTF axes so they compare directly with Three.js and Godot.

License: MIT (see LICENSE in the repository root).
"""

import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

args = sys.argv[sys.argv.index("--") + 1 :]
library, composition_path, out_png = args[0], args[1], args[2]
composition = json.load(open(composition_path))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# glTF axes -> Blender axes.
TO_BLENDER = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def import_asset(ref):
    author_slug, version = ref.split("@")
    path = os.path.join(library, "assets", author_slug, f"v{version}", "model.glb")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    roots = [o for o in new if o.parent is None or o.parent not in new]
    return new, roots


items = []
for index, item in enumerate(composition["items"]):
    objects, roots = import_asset(item["asset"])
    x, y, z = item["position"]
    qx, qy, qz, qw = item["rotation"]
    s = float(item.get("scale", 1.0))
    # The placement as a glTF-space matrix, then expressed in Blender space.
    placement_gltf = (
        Matrix.Translation(Vector((x, y, z)))
        @ Quaternion((qw, qx, qy, qz)).to_matrix().to_4x4()
        @ Matrix.Diagonal(Vector((s, s, s, 1)))
    )
    placement = TO_BLENDER @ placement_gltf @ TO_BLENDER.inverted()
    for root in roots:
        root.matrix_world = placement @ root.matrix_world
    bpy.context.view_layer.update()
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    for obj in objects:
        if obj.type != "MESH":
            continue
        for v in obj.data.vertices:
            w = obj.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    # Back to glTF axes: x, y = Blender z, z = -Blender y.
    items.append(
        {
            "asset": item["asset"],
            "min": [lo.x, lo.z, -hi.y],
            "max": [hi.x, hi.z, -lo.y],
        }
    )

print("COMPOSITION_JSON " + json.dumps(items))

# A simple render: sun, soft world light, camera framing everything from the front-right.
world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.85, 0.85, 0.83, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
scene.world = world
sun_data = bpy.data.lights.new("Sun", "SUN")
sun_data.energy = 3
sun = bpy.data.objects.new("Sun", sun_data)
sun.rotation_euler = (math.radians(50), 0, math.radians(-40))
scene.collection.objects.link(sun)
bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0))

lo = Vector((min(i["min"][0] for i in items), min(-i["max"][2] for i in items), min(i["min"][1] for i in items)))
hi = Vector((max(i["max"][0] for i in items), max(-i["min"][2] for i in items), max(i["max"][1] for i in items)))
centre = (lo + hi) / 2
radius = (hi - lo).length / 2
cam_data = bpy.data.cameras.new("Camera")
cam_data.lens = 50
cam = bpy.data.objects.new("Camera", cam_data)
scene.collection.objects.link(cam)
direction = Vector((math.sin(math.radians(35)), -math.cos(math.radians(35)), math.tan(math.radians(25)))).normalized()
cam.location = centre + direction * radius * 3.4
cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = cam

scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.resolution_x = 1280
scene.render.resolution_y = 800
scene.render.filepath = out_png
bpy.ops.render.render(write_still=True)
print(f"Rendered {out_png}")
