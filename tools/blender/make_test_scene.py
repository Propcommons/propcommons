"""Builds a deliberately messy test scene for export_asset.py and saves it as a .blend file.

    blender --background --factory-startup --python tools/blender/make_test_scene.py -- --out /tmp/test.blend

The "Asset" collection holds a mug-like object made of two parts, with everything a real scene
tends to have: unapplied scale and rotation, an object floating above the ground and off-centre,
live modifiers (bevel and subdivision), quads, vertex colours and an image texture. A "collision"
collection holds one hull. A camera and a light sit outside both collections and must not be
exported. export_asset.py must turn this into a folder that passes `propcommons validate`.

License: MIT (see LICENSE in the repository root).
"""

import argparse
import math
import os
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    return p.parse_args(argv)


def checker_image(path, size=128):
    img = bpy.data.images.new("MugColour", size, size, alpha=False)
    pixels = []
    for y in range(size):
        for x in range(size):
            on = ((x // 16) + (y // 16)) % 2
            pixels += [0.75, 0.3, 0.2, 1.0] if on else [0.95, 0.9, 0.85, 1.0]
    img.pixels = pixels
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def textured_material(image):
    mat = bpy.data.materials.new("Glaze")
    if hasattr(mat, "use_nodes"):
        mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = image
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.4
    return mat


def main():
    args = parse_args()
    out_dir = os.path.dirname(os.path.abspath(args.out))
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    asset = bpy.data.collections.new("Asset")
    collision = bpy.data.collections.new("collision")
    scene.collection.children.link(asset)
    scene.collection.children.link(collision)

    mat = textured_material(checker_image(os.path.join(out_dir, "mug_colour.png")))

    # Body: a cylinder, 4 cm radius and 9 cm tall in the end, but modelled at half size with a
    # scale of 2, rotated, and floating 0.5 m up and off-centre.
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.02, depth=0.045, location=(0.3, -0.2, 0.5))
    body = bpy.context.active_object
    body.name = "Body"
    body.scale = (2, 2, 2)
    body.rotation_euler = (0, 0, math.radians(30))
    body.data.materials.append(mat)
    body.modifiers.new("Bevel", "BEVEL").width = 0.002
    sub = body.modifiers.new("Subdivision", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    body.data.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    bpy.ops.object.shade_smooth()

    # Handle: a torus beside the body, as a second object with the same material.
    bpy.ops.mesh.primitive_torus_add(major_radius=0.012, minor_radius=0.003, location=(0.3 + 0.042, -0.2, 0.5))
    handle = bpy.context.active_object
    handle.name = "Handle"
    handle.rotation_euler = (math.radians(90), 0, 0)
    handle.data.materials.append(mat)

    for obj in (body, handle):
        for c in obj.users_collection:
            c.objects.unlink(obj)
        asset.objects.link(obj)

    # One collision hull around the body.
    bpy.ops.mesh.primitive_cube_add(size=0.08, location=(0.3, -0.2, 0.5))
    hull = bpy.context.active_object
    hull.name = "BodyHull"
    hull.scale = (1, 1, 1.1)
    for c in hull.users_collection:
        c.objects.unlink(hull)
    collision.objects.link(hull)

    # Things that must be left out of the export.
    bpy.ops.object.camera_add(location=(1, -1, 1))
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 3))

    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.out))
    print(f"Saved {args.out}")


if __name__ == "__main__":
    main()
