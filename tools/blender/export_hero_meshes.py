#!/usr/bin/env python3
"""
Hero meshes — real-world proportions + Imagine textures.

Target sizes (meters, after glTF Y-up):
  enemy:   height ~1.80
  car:     L 4.60 × W 1.85 × H 1.48
  dumpster: L 2.05 × W 1.15 × H 1.25  (commercial front-load)
  rifle:   viewmodel, length ~0.75 along barrel

  blender --background --python tools/blender/export_hero_meshes.py
"""

from __future__ import annotations

import math
import os

import bpy
from mathutils import Euler, Vector

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


def bevel(obj, width=0.008, segments=2):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new(name="Bevel", type="BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except Exception:
        pass


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
    parts.append(add_cyl("barrel", 0.01, 0.36, (0, -0.36, 0.02), rot=(math.pi / 2, 0, 0), material=steel, vertices=14))
    parts.append(add_cyl("gas", 0.006, 0.12, (0, -0.22, 0.04), rot=(math.pi / 2, 0, 0), material=dark, vertices=10))
    parts.append(add_cyl("muzzle", 0.015, 0.045, (0, -0.55, 0.02), rot=(math.pi / 2, 0, 0), material=dark, vertices=12))
    parts.append(add_box("mag", (0.03, 0.05, 0.12), (0, 0.0, -0.08), material=dark))
    parts.append(add_box("magwell", (0.036, 0.055, 0.03), (0, 0.0, -0.02), material=body))
    parts.append(add_box("grip", (0.03, 0.045, 0.09), (0, 0.07, -0.09), rot=(0.4, 0, 0), material=poly))
    parts.append(add_box("tguard", (0.024, 0.04, 0.03), (0, 0.05, -0.04), material=dark))
    parts.append(add_box("stock", (0.04, 0.13, 0.045), (0, 0.16, 0.005), material=poly))
    parts.append(add_box("butt", (0.045, 0.035, 0.08), (0, 0.24, -0.01), material=dark))
    parts.append(add_box("cheek", (0.035, 0.06, 0.025), (0, 0.18, 0.035), material=poly))
    parts.append(add_box("optic_mount", (0.025, 0.055, 0.02), (0, 0.0, 0.085), material=dark))
    parts.append(add_cyl("optic", 0.014, 0.07, (0, 0.0, 0.11), rot=(math.pi / 2, 0, 0), material=steel, vertices=12))
    parts.append(add_box("fsight", (0.012, 0.014, 0.03), (0, -0.48, 0.05), material=steel))

    for p in parts:
        bevel(p, width=0.0025, segments=2)

    rifle = join_parts(parts, "rifle")
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    rifle.location = (0, 0, 0)
    print_size(rifle, "rifle")
    bpy.ops.object.select_all(action="DESELECT")
    rifle.select_set(True)
    bpy.context.view_layer.objects.active = rifle
    export_glb(os.path.join(OUT_DIR, "rifle.glb"))


# ---------------------------------------------------------------------------
# ENEMY — target height 1.80 m
# ---------------------------------------------------------------------------
def build_enemy():
    clear_scene()
    albedo = os.path.join(TEX_DIR, "enemy_albedo.jpg")
    rough = os.path.join(TEX_DIR, "roughness.jpg")
    flesh = tex_mat(
        "enemy_flesh", albedo, rough, metallic=0.05, roughness=0.55,
        emission=(0.35, 0.05, 0.04, 1), emission_strength=0.2,
        color_fallback=(0.75, 0.2, 0.15, 1),
    )
    armor = tex_mat("enemy_armor", albedo, rough, metallic=0.45, roughness=0.48, color_fallback=(0.15, 0.1, 0.12, 1))
    cloth = tex_mat("enemy_cloth", albedo, rough, metallic=0.0, roughness=0.9, color_fallback=(0.12, 0.1, 0.12, 1))
    helm = tex_mat(
        "enemy_helm", albedo, rough, metallic=0.55, roughness=0.35,
        emission=(0.4, 0.05, 0.05, 1), emission_strength=0.15,
        color_fallback=(0.2, 0.08, 0.08, 1),
    )

    # Anthropometric proportions for ~1.80m adult
    # head 0.24, neck 0.08, torso 0.60, pelvis 0.20, thigh 0.42, shin 0.42, boot 0.12
    parts = []
    # Feet at z≈0
    parts.append(add_box("boot_l", (0.14, 0.28, 0.12), (-0.12, 0.04, 0.06), material=armor))
    parts.append(add_box("boot_r", (0.14, 0.28, 0.12), (0.12, 0.04, 0.06), material=armor))
    parts.append(add_box("shin_l", (0.12, 0.12, 0.40), (-0.12, 0.0, 0.32), material=cloth))
    parts.append(add_box("shin_r", (0.12, 0.12, 0.40), (0.12, 0.0, 0.32), material=cloth))
    parts.append(add_box("knee_l", (0.13, 0.13, 0.1), (-0.12, 0.02, 0.54), material=armor))
    parts.append(add_box("knee_r", (0.13, 0.13, 0.1), (0.12, 0.02, 0.54), material=armor))
    parts.append(add_box("thigh_l", (0.14, 0.14, 0.40), (-0.12, 0.0, 0.78), material=cloth))
    parts.append(add_box("thigh_r", (0.14, 0.14, 0.40), (0.12, 0.0, 0.78), material=cloth))
    parts.append(add_box("pelvis", (0.34, 0.20, 0.18), (0, 0, 1.05), material=cloth))
    parts.append(add_box("torso", (0.38, 0.22, 0.48), (0, 0, 1.35), material=flesh))
    parts.append(add_box("chest_plate", (0.40, 0.14, 0.32), (0, 0.10, 1.40), material=armor))
    parts.append(add_box("ab_plate", (0.34, 0.12, 0.18), (0, 0.09, 1.18), material=armor))
    parts.append(add_box("back_plate", (0.36, 0.10, 0.36), (0, -0.12, 1.38), material=armor))
    parts.append(add_box("pack", (0.28, 0.14, 0.34), (0, -0.20, 1.42), material=cloth))
    # Arms
    parts.append(add_box("sh_l", (0.16, 0.16, 0.16), (-0.28, 0, 1.58), material=armor))
    parts.append(add_box("sh_r", (0.16, 0.16, 0.16), (0.28, 0, 1.58), material=armor))
    parts.append(add_box("uarm_l", (0.11, 0.11, 0.30), (-0.32, 0.02, 1.36), rot=(0, 0, 0.12), material=flesh))
    parts.append(add_box("uarm_r", (0.11, 0.11, 0.30), (0.32, 0.02, 1.36), rot=(0, 0, -0.12), material=flesh))
    parts.append(add_box("farm_l", (0.10, 0.10, 0.28), (-0.36, 0.04, 1.08), rot=(0, 0, 0.08), material=flesh))
    parts.append(add_box("farm_r", (0.10, 0.10, 0.28), (0.36, 0.04, 1.08), rot=(0, 0, -0.08), material=flesh))
    parts.append(add_box("gaunt_l", (0.12, 0.12, 0.12), (-0.38, 0.05, 0.92), material=armor))
    parts.append(add_box("gaunt_r", (0.12, 0.12, 0.12), (0.38, 0.05, 0.92), material=armor))
    # Head + helmet
    parts.append(add_box("neck", (0.12, 0.12, 0.10), (0, 0, 1.64), material=flesh))
    parts.append(add_box("head", (0.20, 0.20, 0.22), (0, 0.02, 1.78), material=flesh))
    parts.append(add_box("helmet", (0.24, 0.26, 0.18), (0, 0.0, 1.88), material=helm))
    parts.append(add_box("visor", (0.22, 0.10, 0.08), (0, 0.12, 1.80), material=helm))

    for p in parts:
        bevel(p, width=0.008, segments=2)

    enemy = join_parts(parts, "enemy")
    ground_object(enemy)
    print_size(enemy, "enemy")
    bpy.ops.object.select_all(action="DESELECT")
    enemy.select_set(True)
    bpy.context.view_layer.objects.active = enemy
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
    parts.append(add_box("roof", (1.55, 1.50, 0.08), (0.15, 0, 1.52), material=body))
    # Trunk
    parts.append(add_box("trunk", (0.95, 1.72, 0.18), (1.55, 0, 1.05), material=body))
    # Bumpers
    parts.append(add_box("bumper_f", (0.18, 1.86, 0.32), (-2.22, 0, 0.42), material=black))
    parts.append(add_box("bumper_r", (0.18, 1.86, 0.32), (2.22, 0, 0.42), material=black))
    # Side mirrors
    parts.append(add_box("mirror_l", (0.12, 0.18, 0.10), (-0.55, 0.95, 1.15), material=black))
    parts.append(add_box("mirror_r", (0.12, 0.18, 0.10), (-0.55, -0.95, 1.15), material=black))
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
    parts.append(add_box("tl_l", (0.08, 0.28, 0.12), (2.18, 0.55, 0.72), material=light))
    parts.append(add_box("tl_r", (0.08, 0.28, 0.12), (2.18, -0.55, 0.72), material=light))
    # Grille
    parts.append(add_box("grille", (0.06, 0.70, 0.18), (-2.20, 0, 0.55), material=chrome))
    # Windows trim (dark)
    parts.append(add_box("windshield", (0.06, 1.40, 0.42), (-0.70, 0, 1.28), rot=(0, 0.35, 0), material=cabin))

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
