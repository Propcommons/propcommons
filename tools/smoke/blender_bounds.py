"""Imports glTF files into Blender and prints each one's size, converted to glTF axes, as JSON.

    blender --background --factory-startup --python tools/smoke/blender_bounds.py -- a.glb b.glb

Blender is Z-up; the importer converts from glTF's +Y up, so glTF (x, y, z) sizes are Blender's
(x, z, y). Output: one line starting with BOUNDS_JSON followed by a list of [x, y, z] in metres.

License: MIT (see LICENSE in the repository root).
"""

import json
import sys

import bpy
from mathutils import Vector

files = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
sizes = []
for f in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    lo = Vector((float("inf"),) * 3)
    hi = Vector((float("-inf"),) * 3)
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for v in obj.data.vertices:
            w = obj.matrix_world @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i])
                hi[i] = max(hi[i], w[i])
    d = hi - lo
    sizes.append([round(d.x, 6), round(d.z, 6), round(d.y, 6)])
print("BOUNDS_JSON " + json.dumps(sizes))
