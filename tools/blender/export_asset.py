"""Export a Blender collection as a Prop Commons asset (spec 0.1).

Run it on your own machine, in the background, on a saved .blend file:

    blender --background scene.blend --python tools/blender/export_asset.py -- \
        --collection Asset --out assets/alice/strawberry-whole/v1

What it does, without changing your scene (it works on copies and never saves the .blend):

1. Copies every mesh in the collection with modifiers and all transforms applied.
2. Triangulates and joins them into a single object, so the file has one root node.
3. Moves the result so its lowest point is on the ground and its footprint is centred on the
   origin, unless --keep-origin is passed. Blender is Z-up; the exporter's +Y up option converts.
4. Exports model.glb with no cameras, lights, animation, skins, morph targets, vertex colours or
   compression, and with PNG or JPEG images.
5. Exports the objects in a collection named "collision" (if there is one) to collision.glb, one
   mesh per object, with no materials. Each should be a convex hull of at most 64 vertices.
6. Prints the command to validate the result.

Options:
    --collection NAME        collection holding the asset (default: Asset)
    --out FOLDER             version folder to write into (created if missing)
    --keep-origin            keep the object origin instead of re-centring
    --collision NAME         collection holding collision hulls (default: collision)

Tested with: Blender 5.3.0 on macOS (arm64), by test/blender.test.ts, which builds a messy scene
with tools/blender/make_test_scene.py, exports it with this script and validates the result.
Older versions may work: exporter options this Blender doesn't know are skipped. Please report
problems as a GitHub issue.

License: MIT (see LICENSE in the repository root).
"""

import argparse
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector


def parse_args():
    if "--" not in sys.argv:
        fail(
            'Put a lone "--" before this script\'s options, so Blender passes them on, e.g.\n'
            "  blender --background scene.blend --python tools/blender/export_asset.py -- "
            "--collection Asset --out assets/you/your-asset/v1"
        )
    argv = sys.argv[sys.argv.index("--") + 1 :]
    p = argparse.ArgumentParser(prog="export_asset.py", description="Export a Prop Commons asset.")
    p.add_argument("--collection", default="Asset")
    p.add_argument("--out", required=True)
    p.add_argument("--keep-origin", action="store_true")
    p.add_argument("--collision", default="collision")
    return p.parse_args(argv)


def fail(message):
    print(f"export_asset.py: {message}", file=sys.stderr)
    sys.exit(1)


def mesh_objects(collection):
    """Every mesh object in a collection and its child collections."""
    seen = []
    for obj in collection.all_objects:
        if obj.type == "MESH" and obj not in seen:
            seen.append(obj)
    return seen


def warn_procedural_colours(objects):
    """glTF carries image textures and plain colours only. Colours made with other nodes (noise,
    colour ramps, procedural wood) are dropped on export, so the asset comes out plain."""
    warned = set()
    for obj in objects:
        for slot in obj.material_slots:
            mat = slot.material
            if mat is None or mat.name in warned or not getattr(mat, "node_tree", None):
                continue
            for node in mat.node_tree.nodes:
                if node.type != "BSDF_PRINCIPLED":
                    continue
                for socket_name in ("Base Color", "Roughness", "Metallic", "Normal"):
                    socket = node.inputs.get(socket_name)
                    if socket is None or not socket.is_linked:
                        continue
                    source = socket.links[0].from_node
                    if source.type not in ("TEX_IMAGE", "NORMAL_MAP", "SEPARATE_COLOR", "SEPRGB"):
                        print(
                            f'Warning: material "{mat.name}" gets its {socket_name} from a '
                            f'"{source.name}" node. glTF only carries image textures and plain '
                            "values, so this will export without it. Bake it to an image texture "
                            "(power-of-two size), or use a plain value."
                        )
                        warned.add(mat.name)


def evaluated_copy(obj, depsgraph):
    """A new mesh with modifiers applied and the object's world transform baked in."""
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=False, depsgraph=depsgraph)
    mesh.transform(obj.matrix_world)
    if obj.matrix_world.determinant() < 0:
        mesh.flip_normals()  # a mirrored object would otherwise come out inside out
    return mesh


def strip_colours(mesh):
    """Vertex colours are not allowed (GEO-COLOR)."""
    for attr in list(mesh.color_attributes):
        mesh.color_attributes.remove(attr)


def join_meshes(meshes, name):
    """Joins meshes into one, keeping each face's material, and triangulates."""
    materials = []
    bm = bmesh.new()
    for mesh in meshes:
        remap = []
        for mat in mesh.materials:
            if mat not in materials:
                materials.append(mat)
            remap.append(materials.index(mat))
        for poly in mesh.polygons:
            if remap:
                poly.material_index = remap[min(poly.material_index, len(remap) - 1)]
        bm.from_mesh(mesh)  # appends to what is already in the bmesh
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    joined = bpy.data.meshes.new(name)
    bm.to_mesh(joined)
    bm.free()
    for mat in materials:
        joined.materials.append(mat)
    strip_colours(joined)
    return joined


def bounds(meshes):
    lo = Vector((float("inf"),) * 3)
    hi = Vector((float("-inf"),) * 3)
    for mesh in meshes:
        for v in mesh.vertices:
            for i in range(3):
                lo[i] = min(lo[i], v.co[i])
                hi[i] = max(hi[i], v.co[i])
    return lo, hi


def gltf_kwargs(**wanted):
    """Only pass options this Blender's glTF exporter supports (names change between versions)."""
    supported = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    return {k: v for k, v in wanted.items() if k in supported}


def export(objects, filepath, with_materials):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        **gltf_kwargs(
            filepath=filepath,
            export_format="GLB",
            use_selection=True,
            use_visible=False,
            use_renderable=False,
            use_active_collection=False,
            export_yup=True,
            export_apply=True,
            export_texcoords=True,
            export_normals=True,
            export_tangents=False,
            export_materials="EXPORT" if with_materials else "NONE",
            export_image_format="AUTO",  # keeps PNG and JPEG as they are
            export_vertex_color="NONE",
            export_colors=False,
            export_attributes=False,
            export_cameras=False,
            export_lights=False,
            export_animations=False,
            export_skins=False,
            export_morph=False,
            export_extras=False,
            export_draco_mesh_compression_enable=False,
            export_gpu_instances=False,
        )
    )


def main():
    args = parse_args()
    collection = bpy.data.collections.get(args.collection)
    if collection is None:
        fail(f'There is no collection named "{args.collection}". Put the asset in one, or pass --collection.')
    sources = mesh_objects(collection)
    if not sources:
        fail(f'The collection "{args.collection}" has no mesh objects.')

    warn_procedural_colours(sources)
    os.makedirs(args.out, exist_ok=True)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    temp = bpy.data.collections.new("PropCommonsExport")
    bpy.context.scene.collection.children.link(temp)
    created_objects = []
    created_meshes = []
    try:
        copies = [evaluated_copy(o, depsgraph) for o in sources]
        created_meshes += copies
        joined = join_meshes(copies, collection.name)
        created_meshes.append(joined)

        offset = Vector((0.0, 0.0, 0.0))
        if not args.keep_origin:
            lo, hi = bounds([joined])
            # Blender is Z-up: the ground is the XY plane and "lowest" is minimum Z.
            offset = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
            joined.transform(Matrix.Translation(offset))

        model = bpy.data.objects.new(collection.name, joined)
        temp.objects.link(model)
        created_objects.append(model)
        model_path = os.path.join(args.out, "model.glb")
        export([model], model_path, with_materials=True)
        print(f"Wrote {model_path}")

        hull_collection = bpy.data.collections.get(args.collision)
        hulls = mesh_objects(hull_collection) if hull_collection else []
        if hulls:
            hull_objects = []
            for i, src in enumerate(hulls):
                mesh = evaluated_copy(src, depsgraph)
                created_meshes.append(mesh)
                bm = bmesh.new()
                bm.from_mesh(mesh)
                bmesh.ops.triangulate(bm, faces=bm.faces[:])
                bm.to_mesh(mesh)
                bm.free()
                mesh.materials.clear()
                strip_colours(mesh)
                for layer in list(mesh.uv_layers):
                    mesh.uv_layers.remove(layer)
                mesh.transform(Matrix.Translation(offset))
                obj = bpy.data.objects.new(f"hull-{i + 1}", mesh)
                temp.objects.link(obj)
                created_objects.append(obj)
                hull_objects.append(obj)
                if len(mesh.vertices) > 64:
                    print(f'Warning: collision mesh "{src.name}" has {len(mesh.vertices)} vertices; the limit is 64.')
            if len(hull_objects) > 8:
                print(f"Warning: {len(hull_objects)} collision meshes; the limit is 8.")
            collision_path = os.path.join(args.out, "collision.glb")
            export(hull_objects, collision_path, with_materials=False)
            print(f"Wrote {collision_path}")
    finally:
        for obj in created_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        for mesh in created_meshes:
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        bpy.data.collections.remove(temp)

    if not os.path.exists(os.path.join(args.out, "asset.json")):
        print("There is no asset.json yet. Create the folder with `npx propcommons init <you>/<slug>` first,")
        print("or copy template/asset.json and fill it in.")
    print("Now check it:")
    print(f"  npx propcommons validate {args.out}")


if __name__ == "__main__":
    main()
