#!/usr/bin/env python3
"""
Hero meshes — real-world proportions + Imagine textures.

Target sizes (meters, after glTF Y-up):
  enemy:   height ~1.80
  car:     L 4.60 × W 1.85 × H 1.48
  dumpster: L 2.05 × W 1.15 × H 1.25  (commercial front-load)
  rifle:   viewmodel, length ~0.75 along barrel

  blender --background --python-exit-code 1 --python tools/blender/export_hero_meshes.py
"""

from __future__ import annotations

import math
import os

import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "public", "models")
TEX_DIR = os.path.join(OUT_DIR, "textures")


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def load_image(path: str):
    if not os.path.isfile(path):
        print(f"  missing texture: {path}")
        return None
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "sRGB"
    return img


def tex_mat(
    name,
    albedo_path=None,
    roughness_path=None,
    metallic=0.3,
    roughness=0.5,
    emission=None,
    emission_strength=0.0,
    color_fallback=(0.2, 0.2, 0.25, 1),
):
    m = bpy.data.materials.new(name=name)
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = color_fallback
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = metallic
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = roughness
    if albedo_path:
        img = load_image(albedo_path)
        if img:
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = img
            tex.location = (-300, 80)
            links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if roughness_path:
        rimg = load_image(roughness_path)
        if rimg:
            rimg.colorspace_settings.name = "Non-Color"
            rtex = nodes.new("ShaderNodeTexImage")
            rtex.image = rimg
            rtex.location = (-300, -140)
            links.new(rtex.outputs["Color"], bsdf.inputs["Roughness"])
    if emission is not None:
        key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = emission
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return m


def add_box(name, size, loc, rot=(0, 0, 0), material=None):
    """size = (sx, sy, sz) full extents in meters."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    obj.rotation_euler = Euler(rot, "XYZ")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if material:
        obj.data.materials.append(material)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=66, island_margin=0.02)
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def add_cyl(name, radius, depth, loc, rot=(0, 0, 0), material=None, vertices=16):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=loc, vertices=vertices)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = Euler(rot, "XYZ")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if material:
        obj.data.materials.append(material)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.cylinder_project()
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def add_sphere(name, radius, loc, scale=(1, 1, 1), material=None, segments=20, rings=12):
    """Rounded volume used for joints, helmets and organic silhouettes."""
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=loc
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.sphere_project()
    bpy.ops.object.mode_set(mode="OBJECT")
    return obj


def add_capsule_between(name, radius, start, end, material=None, vertices=14):
    """Low-poly beveled limb aligned between two world-space points."""
    a = Vector(start)
    b = Vector(end)
    direction = b - a
    obj = add_cyl(name, radius, direction.length, (a + b) * 0.5, material=material, vertices=vertices)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    bevel(obj, width=radius * 0.38, segments=2)
    return obj


def add_empty(name, loc=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.08
    obj.location = loc
    if parent:
        obj.parent = parent
    return obj


def parent_keep_world(obj, parent):
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world
    return obj


def select_hierarchy(root):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root


def mirror_hierarchy_y(root):
    """
    Convert Blender-authored -Y-forward geometry to the runtime -Z contract.

    Blender's current glTF exporter maps local -Y to glTF +Z. Reflecting every
    hierarchy translation and mesh across Blender Y yields glTF -Z while keeping
    articulation pivots and the exported root transform at identity.
    """
    reflection = Matrix.Scale(-1.0, 4, Vector((0, 1, 0)))
    for obj in (root, *root.children_recursive):
        obj.location.y *= -1
        if obj.type == "MESH":
            obj.data.transform(reflection)
            obj.data.flip_normals()


def apply_modifier_or_raise(obj, modifier_name, apply_fn=None):
    """Apply a modifier and preserve enough context to diagnose export failures."""
    if apply_fn is None:
        apply_fn = bpy.ops.object.modifier_apply
    try:
        apply_fn(modifier=modifier_name)
    except Exception as exc:
        raise RuntimeError(
            f"Failed to apply modifier {modifier_name!r} to object {obj.name!r}"
        ) from exc


def bevel(obj, width=0.008, segments=2):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new(name="Bevel", type="BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    apply_modifier_or_raise(obj, mod.name)


def join_parts(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    return obj


def ground_object(obj):
    """Put lowest vertex at Z=0, origin at ground center."""
    bpy.context.view_layer.update()
    coords = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    min_z = min(v.z for v in coords)
    obj.location.z -= min_z
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    # Keep origin on ground plane
    coords = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    min_z = min(v.z for v in coords)
    # Move mesh up so min_z = 0 while keeping origin at feet
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.transform.translate(value=(0, 0, -min_z))
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.location = (0, 0, 0)


def print_size(obj, label):
    coords = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    xs = [v.x for v in coords]
    ys = [v.y for v in coords]
    zs = [v.z for v in coords]
    print(
        f"  {label}: Lx={max(xs)-min(xs):.2f} Ly={max(ys)-min(ys):.2f} H={max(zs)-min(zs):.2f}"
    )


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="JPEG",
        export_yup=True,
        export_extras=True,
    )
    print(f"  wrote {path} ({os.path.getsize(path)} bytes)")


# ---------------------------------------------------------------------------
# RIFLE — viewmodel, barrel along -Y (Blender forward)
# ---------------------------------------------------------------------------
def build_rifle():
    """
    Viewmodel rifle. Coord contract (sync with src/weapons/WeaponsSystem.js):
      Blender: +Z up, barrel along −Y. glTF export_yup → Three: +Y up, barrel −Z.
      Hip/ADS camera-local poses are applied in weapons, not baked here.
    """
    clear_scene()
    albedo = os.path.join(TEX_DIR, "rifle_albedo.jpg")
    rough = os.path.join(TEX_DIR, "roughness.jpg")
    body = tex_mat("rifle_body", albedo, rough, metallic=0.55, roughness=0.45, color_fallback=(0.18, 0.2, 0.24, 1))
    dark = tex_mat("rifle_dark", albedo, rough, metallic=0.65, roughness=0.4, color_fallback=(0.08, 0.09, 0.11, 1))
    poly = tex_mat("rifle_poly", albedo, rough, metallic=0.1, roughness=0.85, color_fallback=(0.12, 0.14, 0.12, 1))
    steel = tex_mat("rifle_steel", albedo, rough, metallic=0.9, roughness=0.28, color_fallback=(0.45, 0.48, 0.52, 1))

    parts = []
    parts.append(add_box("lower", (0.05, 0.16, 0.055), (0, 0.0, 0.0), material=body))
    parts.append(add_box("upper", (0.045, 0.14, 0.04), (0, -0.01, 0.04), material=dark))
    parts.append(add_box("rail", (0.028, 0.12, 0.014), (0, -0.01, 0.068), material=steel))
    for i, y in enumerate((-0.04, 0.02, 0.08)):
        parts.append(add_box(f"pic_{i}", (0.03, 0.008, 0.006), (0, y, 0.076), material=steel))
    parts.append(add_box("hg", (0.05, 0.14, 0.045), (0, -0.14, 0.01), material=poly))
    for i in range(4):
        parts.append(add_box(f"vent_{i}", (0.008, 0.02, 0.012), (0.028, -0.1 - i * 0.025, 0.02), material=dark))
    parts.append(add_cyl("barrel", 0.01, 0.27, (0, -0.335, 0.02), rot=(math.pi / 2, 0, 0), material=steel, vertices=14))
    parts.append(add_cyl("gas", 0.006, 0.12, (0, -0.22, 0.04), rot=(math.pi / 2, 0, 0), material=dark, vertices=10))
    parts.append(add_cyl("muzzle", 0.015, 0.04, (0, -0.49, 0.02), rot=(math.pi / 2, 0, 0), material=dark, vertices=12))
    magazine = add_box("magazine", (0.034, 0.055, 0.13), (0, 0.0, -0.085), rot=(0.14, 0, 0), material=dark)
    parts.append(add_box("magwell", (0.036, 0.055, 0.03), (0, 0.0, -0.02), material=body))
    parts.append(add_box("grip", (0.03, 0.045, 0.09), (0, 0.07, -0.09), rot=(0.4, 0, 0), material=poly))
    parts.append(add_box("tguard", (0.024, 0.04, 0.03), (0, 0.05, -0.04), material=dark))
    parts.append(add_box("stock", (0.04, 0.13, 0.045), (0, 0.16, 0.005), material=poly))
    parts.append(add_box("butt", (0.045, 0.035, 0.08), (0, 0.24, -0.01), material=dark))
    parts.append(add_box("cheek", (0.035, 0.06, 0.025), (0, 0.18, 0.035), material=poly))
    parts.append(add_box("fsight", (0.012, 0.014, 0.03), (0, -0.44, 0.05), material=steel))
    # Readable authored details in first-person close-up.
    parts.append(add_box("ejection_port", (0.008, 0.065, 0.026), (0.027, -0.015, 0.025), material=steel))
    parts.append(add_box("charging_handle", (0.075, 0.014, 0.014), (0, 0.052, 0.052), material=dark))
    parts.append(add_cyl("forward_grip", 0.014, 0.075, (0, -0.17, -0.052), material=poly, vertices=12))
    parts.append(add_box("sling_loop", (0.055, 0.01, 0.038), (0, 0.225, 0.01), material=steel))
    for i, y in enumerate((-0.105, -0.14, -0.175, -0.21)):
        parts.append(add_box(f"handguard_rib_{i}", (0.057, 0.009, 0.052), (0, y, 0.012), material=body))
    for side in (-1, 1):
        parts.append(add_box(f"muzzle_port_{side}", (0.008, 0.023, 0.012), (side * 0.014, -0.49, 0.02), material=steel))

    for p in parts:
        bevel(p, width=0.0025, segments=2)
    bevel(magazine, width=0.0035, segments=2)

    rifle_body = join_parts(parts, "rifle_body")
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    rifle_body.location = (0, 0, 0)
    rifle = add_empty("rifle")
    rifle["forward_axis"] = "-Z"
    parent_keep_world(rifle_body, rifle)
    parent_keep_world(magazine, rifle)
    muzzle_socket = add_empty("muzzle_socket", (0, -0.515, 0.02), rifle)
    muzzle_socket["forward_axis"] = "-Y Blender / -Z glTF"
    print_size(rifle_body, "rifle")
    mirror_hierarchy_y(rifle)
    select_hierarchy(rifle)
    export_glb(os.path.join(OUT_DIR, "rifle.glb"))


# ---------------------------------------------------------------------------
# ENEMY — target height 1.80 m
# ---------------------------------------------------------------------------
def build_enemy():
    clear_scene()
    albedo = os.path.join(TEX_DIR, "enemy_albedo.jpg")
    rough = os.path.join(TEX_DIR, "roughness.jpg")
    skin = tex_mat(
        "enemy_skin", albedo, rough, metallic=0.0, roughness=0.72,
        color_fallback=(0.42, 0.23, 0.18, 1),
    )
    armor = tex_mat(
        "enemy_armor", albedo, rough, metallic=0.28, roughness=0.58,
        color_fallback=(0.16, 0.19, 0.17, 1),
    )
    cloth = tex_mat(
        "enemy_cloth", albedo, rough, metallic=0.0, roughness=0.92,
        color_fallback=(0.13, 0.16, 0.14, 1),
    )
    webbing = tex_mat(
        "enemy_webbing", None, None, metallic=0.05, roughness=0.88,
        color_fallback=(0.26, 0.25, 0.17, 1),
    )
    dark = tex_mat(
        "enemy_dark_metal", None, None, metallic=0.75, roughness=0.48,
        color_fallback=(0.055, 0.065, 0.065, 1),
    )
    lens = tex_mat(
        "enemy_lens", None, None, metallic=0.15, roughness=0.22,
        emission=(0.35, 0.055, 0.025, 1), emission_strength=0.8,
        color_fallback=(0.25, 0.045, 0.02, 1),
    )

    rig = add_empty("enemy_rig")
    rig["articulation"] = "direct-groups-v1"
    rig["forward_axis"] = "-Z"
    rig["height_m"] = 1.80

    # Core silhouette: tapered torso, vest, pelvis, pouches and radio pack.
    core = [
        add_box("pelvis", (0.34, 0.23, 0.19), (0, 0, 0.95), material=cloth),
        add_box("torso", (0.38, 0.23, 0.48), (0, 0, 1.27), material=cloth),
        add_box("plate_carrier", (0.43, 0.16, 0.34), (0, -0.08, 1.34), material=armor),
        add_box("back_plate", (0.37, 0.11, 0.35), (0, 0.14, 1.34), material=armor),
        add_box("radio_pack", (0.24, 0.12, 0.27), (0.08, 0.22, 1.38), material=webbing),
        add_box("belt", (0.39, 0.25, 0.08), (0, 0, 1.02), material=webbing),
        add_box("pouch_l", (0.11, 0.10, 0.16), (-0.15, -0.15, 1.04), material=webbing),
        add_box("pouch_r", (0.11, 0.10, 0.16), (0.15, -0.15, 1.04), material=webbing),
    ]
    for part in core:
        bevel(part, width=0.018, segments=3)
        parent_keep_world(part, rig)

    # Legs pivot at each hip. Combat animates these named groups directly.
    for side, x in (("l", -0.12), ("r", 0.12)):
        leg = add_empty(f"leg_{side}", (x, 0, 0.99), rig)
        leg["pivot"] = "hip"
        pieces = [
            add_capsule_between(f"thigh_{side}", 0.095, (x, 0, 0.95), (x, 0.01, 0.59), cloth),
            add_sphere(f"knee_{side}", 0.105, (x, -0.02, 0.55), scale=(1.0, 0.86, 0.78), material=armor),
            add_capsule_between(f"shin_{side}", 0.082, (x, 0, 0.52), (x, 0.02, 0.17), cloth),
            add_box(f"boot_{side}", (0.17, 0.31, 0.13), (x, -0.075, 0.075), material=dark),
        ]
        bevel(pieces[-1], width=0.025, segments=3)
        for piece in pieces:
            parent_keep_world(piece, leg)

    # Arms begin in a compact low-ready pose and remain independently rotatable.
    arm_specs = {
        "l": ((-0.25, -0.01, 1.50), (-0.34, -0.16, 1.29), (-0.17, -0.33, 1.24)),
        "r": ((0.25, -0.01, 1.50), (0.34, -0.12, 1.30), (0.13, -0.27, 1.19)),
    }
    arm_groups = {}
    for side, (shoulder, elbow, hand) in arm_specs.items():
        arm = add_empty(f"arm_{side}", shoulder, rig)
        arm["pivot"] = "shoulder"
        arm_groups[side] = arm
        pieces = [
            add_sphere(f"shoulder_{side}", 0.13, shoulder, scale=(1.0, 0.9, 1.05), material=armor),
            add_capsule_between(f"upper_arm_{side}", 0.075, shoulder, elbow, cloth),
            add_sphere(f"elbow_{side}", 0.082, elbow, scale=(1.0, 0.9, 0.9), material=armor),
            add_capsule_between(f"forearm_{side}", 0.068, elbow, hand, cloth),
            add_sphere(f"glove_{side}", 0.075, hand, scale=(0.9, 1.15, 0.8), material=dark),
        ]
        for piece in pieces:
            parent_keep_world(piece, arm)

    # Neck/head is one rotatable hierarchy for look/aim animation.
    head_group = add_empty("head", (0, 0, 1.55), rig)
    head_group["pivot"] = "neck"
    head_parts = [
        add_cyl("neck_mesh", 0.072, 0.12, (0, 0, 1.60), material=skin, vertices=14),
        add_sphere("head_mesh", 0.13, (0, -0.015, 1.71), scale=(0.84, 0.94, 1.08), material=skin),
        add_sphere("helmet_shell", 0.15, (0, 0.005, 1.77), scale=(1.04, 1.12, 0.72), material=armor),
        add_box("helmet_rail", (0.29, 0.06, 0.055), (0, -0.11, 1.76), material=dark),
        add_box("goggle_lens", (0.19, 0.045, 0.058), (0, -0.132, 1.70), material=lens),
    ]
    bevel(head_parts[3], width=0.012, segments=2)
    bevel(head_parts[4], width=0.014, segments=3)
    for piece in head_parts:
        parent_keep_world(piece, head_group)

    # Compact carried rifle. Its hierarchy provides stable weapon/muzzle sockets.
    # Local offset from the right-shoulder pivot to the firing hand.
    weapon_socket = add_empty("weapon_socket", (-0.12, -0.26, -0.31), arm_groups["r"])
    weapon_socket["purpose"] = "enemy-weapon-attachment"
    weapon = add_empty("enemy_weapon", (0, 0, 0), weapon_socket)
    weapon_parts = [
        add_box("enemy_rifle_receiver", (0.075, 0.30, 0.075), (-0.13, -0.12, 0.03), material=dark),
        add_box("enemy_rifle_stock", (0.07, 0.16, 0.09), (-0.13, 0.10, 0.03), material=armor),
        add_box("enemy_rifle_handguard", (0.065, 0.20, 0.067), (-0.13, -0.35, 0.03), material=armor),
        add_cyl("enemy_rifle_barrel", 0.018, 0.34, (-0.13, -0.57, 0.03), rot=(math.pi / 2, 0, 0), material=dark, vertices=12),
        add_box("enemy_rifle_mag", (0.055, 0.10, 0.18), (-0.13, -0.11, -0.09), rot=(0.18, 0, 0), material=dark),
        add_box("enemy_rifle_optic", (0.06, 0.10, 0.075), (-0.13, -0.15, 0.11), material=lens),
    ]
    for piece in weapon_parts:
        bevel(piece, width=0.008, segments=2)
        piece.parent = weapon
    muzzle = add_empty("muzzle_socket", (-0.13, -0.75, 0.03), weapon)
    muzzle["forward_axis"] = "-Y Blender / -Z glTF"

    # Antenna breaks the shoulder outline and reinforces the tactical read.
    antenna = add_capsule_between("radio_antenna", 0.012, (0.13, 0.22, 1.48), (0.18, 0.22, 1.78), dark, 8)
    parent_keep_world(antenna, rig)

    mirror_hierarchy_y(rig)
    select_hierarchy(rig)
    print("  enemy articulation: arm_l arm_r leg_l leg_r head; weapon_socket; muzzle_socket")
    export_glb(os.path.join(OUT_DIR, "enemy.glb"))


# ---------------------------------------------------------------------------
# DUMPSTER — commercial front-load ~2.05 × 1.15 × 1.25 m
# Blender: X = length (street-parallel when placed), Y = depth, Z = height
# ---------------------------------------------------------------------------
def build_dumpster():
    clear_scene()
    albedo = os.path.join(TEX_DIR, "dumpster_albedo.jpg")
    rough = os.path.join(TEX_DIR, "roughness.jpg")
    metal = tex_mat("dump_metal", albedo, rough, metallic=0.7, roughness=0.42, color_fallback=(0.25, 0.32, 0.28, 1))
    lid = tex_mat("dump_lid", albedo, rough, metallic=0.55, roughness=0.5, color_fallback=(0.2, 0.22, 0.2, 1))
    rust = tex_mat("dump_rust", albedo, rough, metallic=0.25, roughness=0.8, color_fallback=(0.35, 0.2, 0.12, 1))
    wheel = tex_mat("dump_wheel", None, None, metallic=0.1, roughness=0.95, color_fallback=(0.05, 0.05, 0.05, 1))

    # Target: L=2.05 (X), D=1.15 (Y), H=1.25 (Z) including lid
    L, D, H = 2.05, 1.15, 1.15  # body height; lid on top
    parts = []
    # Main bin body — sits on small feet/wheels
    parts.append(add_box("body", (L * 0.96, D * 0.92, H * 0.88), (0, 0, 0.12 + H * 0.44), material=metal))
    # Side wall ribs (detail)
    for i, x in enumerate((-0.7, -0.35, 0.0, 0.35, 0.7)):
        parts.append(add_box(f"rib_{i}", (0.04, D * 0.94, H * 0.75), (x, 0, 0.15 + H * 0.4), material=rust))
    # Front lip / load edge
    parts.append(add_box("lip", (L * 0.98, 0.08, 0.1), (0, D * 0.42, 0.12 + H * 0.88), material=rust))
    # Lid (slightly larger, closed)
    parts.append(add_box("lid", (L, D * 0.98, 0.08), (0, 0, 0.12 + H * 0.88 + 0.05), material=lid))
    # Lid hinge bar
    parts.append(add_box("hinge", (L * 0.95, 0.06, 0.05), (0, -D * 0.42, 0.12 + H * 0.88), material=rust))
    # Casters — real dumpsters sit ~12cm off ground
    for x in (-0.75, 0.75):
        for y in (-0.38, 0.38):
            parts.append(
                add_cyl(f"wheel_{x}_{y}", 0.10, 0.08, (x, y, 0.10), rot=(0, math.pi / 2, 0), material=wheel, vertices=12)
            )
            parts.append(add_box(f"bracket_{x}_{y}", (0.08, 0.08, 0.12), (x, y, 0.18), material=rust))

    for p in parts:
        bevel(p, width=0.012, segments=2)

    dump = join_parts(parts, "dumpster")
    ground_object(dump)
    print_size(dump, "dumpster")
    bpy.ops.object.select_all(action="DESELECT")
    dump.select_set(True)
    bpy.context.view_layer.objects.active = dump
    export_glb(os.path.join(OUT_DIR, "dumpster.glb"))


# ---------------------------------------------------------------------------
# CAR — compact sedan 4.60 L × 1.85 W × 1.48 H
# Blender: X = length, Y = width, Z = height
# ---------------------------------------------------------------------------
def build_car():
    clear_scene()
    albedo = os.path.join(TEX_DIR, "car_albedo.jpg")
    rough = os.path.join(TEX_DIR, "roughness.jpg")
    body = tex_mat("car_body", albedo, rough, metallic=0.82, roughness=0.28, color_fallback=(0.15, 0.22, 0.35, 1))
    cabin = tex_mat(
        "car_cabin", albedo, rough, metallic=0.15, roughness=0.18,
        emission=(0.04, 0.08, 0.12, 1), emission_strength=0.3,
        color_fallback=(0.05, 0.08, 0.12, 1),
    )
    tire = tex_mat("car_tire", None, None, metallic=0.0, roughness=0.95, color_fallback=(0.04, 0.04, 0.04, 1))
    rim = tex_mat("car_rim", albedo, rough, metallic=0.9, roughness=0.25, color_fallback=(0.5, 0.52, 0.55, 1))
    light = tex_mat(
        "car_light", None, None, metallic=0.0, roughness=0.2,
        emission=(1.0, 0.92, 0.6, 1), emission_strength=2.8,
        color_fallback=(0.95, 0.95, 0.85, 1),
    )
    tail = tex_mat(
        "car_tail_light", None, None, metallic=0.0, roughness=0.28,
        emission=(0.8, 0.035, 0.015, 1), emission_strength=1.4,
        color_fallback=(0.55, 0.02, 0.01, 1),
    )
    chrome = tex_mat("car_chrome", albedo, rough, metallic=1.0, roughness=0.12, color_fallback=(0.65, 0.67, 0.7, 1))
    black = tex_mat("car_black", None, None, metallic=0.2, roughness=0.7, color_fallback=(0.04, 0.04, 0.05, 1))

    # Real compact sedan proportions (meters)
    # Wheelbase ~2.65, overall L 4.60, W 1.82, H 1.48, ground clearance ~0.15
    # Wheel diameter ~0.64 (tire), track ~1.55
    parts = []
    # Lower body / rocker
    parts.append(add_box("sill", (4.30, 1.78, 0.28), (0, 0, 0.42), material=body))
    # Main body volume
    parts.append(add_box("body", (4.40, 1.82, 0.55), (0, 0, 0.72), material=body))
    # Hood (front is -X)
    parts.append(add_box("hood", (1.15, 1.72, 0.14), (-1.35, 0, 1.02), material=body))
    # Cabin greenhouse
    parts.append(add_box("cabin", (1.70, 1.62, 0.55), (0.15, 0, 1.22), material=cabin))
    # Roof
    parts.append(add_box("roof", (1.55, 1.50, 0.08), (0.15, 0, 1.49), material=body))
    # Trunk
    parts.append(add_box("trunk", (0.95, 1.72, 0.18), (1.55, 0, 1.05), material=body))
    # Bumpers
    parts.append(add_box("bumper_f", (0.18, 1.86, 0.32), (-2.22, 0, 0.42), material=black))
    parts.append(add_box("bumper_r", (0.18, 1.86, 0.32), (2.22, 0, 0.42), material=black))
    # Side mirrors
    parts.append(add_box("mirror_l", (0.12, 0.14, 0.10), (-0.55, 0.86, 1.15), material=black))
    parts.append(add_box("mirror_r", (0.12, 0.14, 0.10), (-0.55, -0.86, 1.15), material=black))
    # A-pillars (visual)
    parts.append(add_box("apil_l", (0.08, 0.06, 0.45), (-0.65, 0.72, 1.25), rot=(0, 0.15, 0), material=body))
    parts.append(add_box("apil_r", (0.08, 0.06, 0.45), (-0.65, -0.72, 1.25), rot=(0, -0.15, 0), material=body))
    # Wheels — diameter 0.64, width 0.22, centers at wheelbase ±1.32 from center
    for x in (-1.32, 1.32):
        for y in (-0.78, 0.78):
            parts.append(
                add_cyl(f"tire_{x}_{y}", 0.32, 0.22, (x, y, 0.32), rot=(math.pi / 2, 0, 0), material=tire, vertices=16)
            )
            parts.append(
                add_cyl(f"rim_{x}_{y}", 0.18, 0.16, (x, y, 0.32), rot=(math.pi / 2, 0, 0), material=rim, vertices=12)
            )
    # Headlights + taillights
    parts.append(add_box("hl_l", (0.10, 0.32, 0.14), (-2.15, 0.55, 0.68), material=light))
    parts.append(add_box("hl_r", (0.10, 0.32, 0.14), (-2.15, -0.55, 0.68), material=light))
    parts.append(add_box("tl_l", (0.08, 0.28, 0.12), (2.18, 0.55, 0.72), material=tail))
    parts.append(add_box("tl_r", (0.08, 0.28, 0.12), (2.18, -0.55, 0.72), material=tail))
    # Grille
    parts.append(add_box("grille", (0.06, 0.70, 0.18), (-2.20, 0, 0.55), material=chrome))
    # Windows trim (dark)
    parts.append(add_box("windshield", (0.06, 1.40, 0.42), (-0.70, 0, 1.28), rot=(0, 0.35, 0), material=cabin))
    # Door cuts, handles and plates keep the sedan readable at cover distance.
    for side in (-1, 1):
        y = side * 0.915
        parts.append(add_box(f"beltline_{side}", (2.55, 0.025, 0.035), (0.15, y, 0.93), material=black))
        for x in (-0.35, 0.75):
            parts.append(add_box(f"handle_{side}_{x}", (0.18, 0.035, 0.035), (x, y, 1.0), material=chrome))
    parts.append(add_box("front_plate", (0.04, 0.42, 0.14), (-2.27, 0, 0.43), material=light))
    parts.append(add_box("rear_plate", (0.04, 0.42, 0.14), (2.27, 0, 0.52), material=light))
    parts.append(add_cyl("exhaust", 0.035, 0.18, (2.14, -0.55, 0.2), rot=(0, math.pi / 2, 0), material=black, vertices=10))

    for p in parts:
        bevel(p, width=0.015, segments=3)

    car = join_parts(parts, "car")
    ground_object(car)
    print_size(car, "car")
    bpy.ops.object.select_all(action="DESELECT")
    car.select_set(True)
    bpy.context.view_layer.objects.active = car
    export_glb(os.path.join(OUT_DIR, "car.glb"))


def main():
    print("=== hero meshes @ real-world scale ===")
    os.makedirs(OUT_DIR, exist_ok=True)
    print("rifle…")
    build_rifle()
    print("enemy…")
    build_enemy()
    print("dumpster…")
    build_dumpster()
    print("car…")
    build_car()
    print("done.")


if __name__ == "__main__":
    main()
